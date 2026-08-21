import { getSetting } from "./settings";
import {
  describeChannelRef,
  isChannelId,
  parseChannelInput,
  type ChannelRef,
} from "./youtubeChannel";
import { parseVideoInput, watchUrl } from "./youtubeVideo";

// Channel statistics, straight from the YouTube Data API. One API key, no
// OAuth, no browser round trip — which matters because JARVIS is asked for
// these mid-sentence and a consent screen would end the conversation.
//
// What this can and cannot see is worth being straight about: these are the
// public numbers, the same ones on the channel page. Subscriber counts above
// 1,000 are rounded by YouTube itself, and watch time, impressions and
// click-through live behind the separate Analytics API, which needs OAuth as
// the channel's owner.

const API_BASE = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 15_000;

/**
 * The key to use. An explicit YouTube key wins; failing that a Gemini key is
 * worth a try, since both are ordinary Google API keys and one project can
 * serve both — it just needs YouTube Data API v3 switched on, which the error
 * below says in as many words when it isn't.
 */
function apiKey(): string {
  const key = getSetting("YOUTUBE_API_KEY") || getSetting("GEMINI_API_KEY");
  if (!key) {
    throw new Error(
      "No YouTube key configured yet, sir — add one in Settings → YouTube."
    );
  }
  return key;
}

export function isYouTubeConfigured(): boolean {
  return Boolean(getSetting("YOUTUBE_API_KEY") || getSetting("GEMINI_API_KEY"));
}

/** The channel to report on when he doesn't name one. */
export function configuredChannel(): string | undefined {
  return getSetting("YOUTUBE_CHANNEL")?.trim() || undefined;
}

/** Google's error bodies are consistent enough to turn into a real sentence. */
function googleError(status: number, body: string): Error {
  let message = "";
  let reason = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    message = parsed.error?.message ?? "";
    reason = parsed.error?.errors?.[0]?.reason ?? "";
  } catch {
    message = body.slice(0, 200);
  }

  const haystack = `${reason} ${message}`;

  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(haystack)) {
    return new Error(
      "That Google key works, but YouTube Data API v3 isn't switched on for its project. Open console.cloud.google.com → APIs & Services → Library, search for “YouTube Data API v3”, and enable it. It's free."
    );
  }
  if (/ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED|referer/i.test(haystack)) {
    return new Error(
      "Google is refusing that key because it's restricted to particular websites. JARVIS calls YouTube from your own computer, not from a web page, so in the key's settings set Application restrictions to “None” (or to IP addresses)."
    );
  }
  if (/API key not valid|keyInvalid|API_KEY_INVALID/i.test(haystack)) {
    return new Error("Google says that YouTube key isn't valid. Copy it again in full.");
  }
  if (/quotaExceeded|quota/i.test(haystack)) {
    return new Error(
      "The YouTube API quota for that key is spent for today, sir — it resets at midnight Pacific time."
    );
  }
  return new Error(message ? `YouTube said: ${message}` : `YouTube returned HTTP ${status}.`);
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ ...params, key: apiKey() });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${path}?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("YouTube didn't answer in time, sir — the connection may be down.");
    }
    throw err;
  }
  if (!res.ok) throw googleError(res.status, await res.text());
  return (await res.json()) as T;
}

interface ChannelResource {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    thumbnails?: { default?: { url?: string } };
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

export interface ChannelStats {
  id: string;
  title: string;
  handle: string | null;
  url: string;
  createdAt: string | null;
  subscribers: number | null;
  subscribersHidden: boolean;
  views: number;
  videos: number;
  uploadsPlaylistId: string | null;
  /** Said out loud, because a rounded number presented as exact is a lie. */
  note: string;
}

function toNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const CHANNEL_PARTS = "snippet,statistics,contentDetails";

/**
 * Find the channel, whichever way it was named.
 *
 * Handle and id are single lookups. A bare name has to go through search,
 * which costs 100 units of the daily 10,000 quota against 1 for a lookup — so
 * it's the last resort, and once resolved the id is what gets used.
 */
async function fetchChannel(ref: ChannelRef): Promise<ChannelResource | null> {
  if (ref.kind === "id") {
    const data = await call<{ items?: ChannelResource[] }>("channels", {
      part: CHANNEL_PARTS,
      id: ref.value,
    });
    return data.items?.[0] ?? null;
  }

  // A lookup that finds nothing falls through to search below. So does one
  // that is refused outright: forHandle is a relatively recent addition, and a
  // search still gets there even if a future API stops accepting it.
  const lookup = async (param: "forHandle" | "forUsername") => {
    try {
      const data = await call<{ items?: ChannelResource[] }>("channels", {
        part: CHANNEL_PARTS,
        [param]: ref.value,
      });
      return data.items?.[0] ?? null;
    } catch (err) {
      // A key or quota problem is real and must surface; only an argument the
      // API didn't like is worth stepping past.
      if (/isn't valid|quota|isn't switched on|restricted to particular/i.test(String(err))) {
        throw err;
      }
      return null;
    }
  };

  if (ref.kind === "handle") {
    const found = await lookup("forHandle");
    if (found) return found;
  }

  if (ref.kind === "username") {
    const found = await lookup("forUsername");
    if (found) return found;
  }

  // Search, then look the winner up properly — search results carry no
  // statistics of their own.
  const found = await call<{ items?: { id?: { channelId?: string } }[] }>("search", {
    part: "snippet",
    type: "channel",
    maxResults: "1",
    q: ref.value,
  });
  const id = found.items?.[0]?.id?.channelId;
  if (!id) return null;
  return fetchChannel({ kind: "id", value: id });
}

export async function channelStats(input?: string): Promise<ChannelStats> {
  const raw = input?.trim() || configuredChannel();
  if (!raw) {
    throw new Error(
      "I don't know which channel is yours, sir — set it in Settings → YouTube, or tell me the @handle."
    );
  }

  const ref = parseChannelInput(raw);
  if (!ref) throw new Error("That doesn't look like a channel, sir.");

  const channel = await fetchChannel(ref);
  if (!channel) {
    throw new Error(
      `YouTube has no channel matching "${describeChannelRef(ref)}", sir. The @handle from the channel page is the surest way to name it.`
    );
  }

  const hidden = channel.statistics?.hiddenSubscriberCount === true;
  const subscribers = hidden ? null : toNumber(channel.statistics?.subscriberCount);
  const handle = channel.snippet?.customUrl?.replace(/^@?/, "@") ?? null;

  return {
    id: channel.id,
    title: channel.snippet?.title ?? "Unknown channel",
    handle,
    url: `https://www.youtube.com/channel/${channel.id}`,
    createdAt: channel.snippet?.publishedAt ?? null,
    subscribers,
    subscribersHidden: hidden,
    views: toNumber(channel.statistics?.viewCount),
    videos: toNumber(channel.statistics?.videoCount),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
    note:
      subscribers !== null && subscribers >= 1000
        ? "YouTube rounds public subscriber counts, so this is approximate above a thousand. Studio has the exact figure."
        : "",
  };
}

export interface VideoStats {
  id: string;
  title: string;
  publishedAt: string | null;
  url: string;
  views: number;
  likes: number;
  comments: number;
}

export interface RecentVideos {
  channel: ChannelStats;
  videos: VideoStats[];
  averageViews: number;
  best: VideoStats | null;
}

/**
 * The last N uploads with their numbers.
 *
 * Via the uploads playlist rather than search: search is 100 quota units and
 * returns results that lag behind reality, while the playlist is 1 unit and is
 * exactly what the channel has published, newest first.
 */
export async function recentVideos(input?: string, limit = 10): Promise<RecentVideos> {
  const channel = await channelStats(input);
  const capped = Math.max(1, Math.min(Math.floor(limit) || 10, 50));

  if (!channel.uploadsPlaylistId) {
    return { channel, videos: [], averageViews: 0, best: null };
  }

  const playlist = await call<{
    items?: { contentDetails?: { videoId?: string } }[];
  }>("playlistItems", {
    part: "contentDetails",
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(capped),
  });

  const ids = (playlist.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) return { channel, videos: [], averageViews: 0, best: null };

  const details = await call<{
    items?: {
      id: string;
      snippet?: { title?: string; publishedAt?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }[];
  }>("videos", { part: "snippet,statistics", id: ids.join(",") });

  const videos: VideoStats[] = (details.items ?? []).map((video) => ({
    id: video.id,
    title: video.snippet?.title ?? "Untitled",
    publishedAt: video.snippet?.publishedAt ?? null,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    views: toNumber(video.statistics?.viewCount),
    likes: toNumber(video.statistics?.likeCount),
    comments: toNumber(video.statistics?.commentCount),
  }));

  // The playlist is in upload order; `videos` follows whatever order the
  // batch lookup returned, so restore it.
  videos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const total = videos.reduce((sum, video) => sum + video.views, 0);
  const best = videos.reduce<VideoStats | null>(
    (top, video) => (top === null || video.views > top.views ? video : top),
    null
  );

  return {
    channel,
    videos,
    averageViews: videos.length ? Math.round(total / videos.length) : 0,
    best,
  };
}

export { isChannelId };


// ---------------------------------------------------------------------------
// Finding one particular thing, so it can be opened rather than searched for.
//
// "Pull up that video" means a video, not a page of results. Search costs 100
// quota units against a daily 10,000 — about a hundred lookups a day — so a
// link or an id he already has is used directly rather than looked up, and a
// found id is what gets opened.
// ---------------------------------------------------------------------------

export interface FoundVideo {
  id: string;
  title: string;
  channel: string;
  url: string;
  publishedAt: string | null;
  /** Present only when it came back from a search rather than a link. */
  description?: string;
}

interface SearchItem {
  id?: { videoId?: string; channelId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    description?: string;
    publishedAt?: string;
  };
}

/** Strip everything that differs between a spoken title and a written one. */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a result matches what he asked for. An exact title beats a title
 * that merely contains the words, which beats YouTube's own ranking — search
 * puts popular things first, and "that exact video" is a different question
 * from "the most popular video about this".
 */
export function rankMatch(title: string, query: string): number {
  const a = comparable(title);
  const b = comparable(query);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 80;
  if (a.includes(b)) return 60;

  const words = b.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const hits = words.filter((word) => a.includes(word)).length;
  return Math.round((hits / words.length) * 50);
}

/**
 * Videos matching a title, best match first.
 *
 * A link or a bare id short-circuits the search entirely: it already names one
 * video, and searching could only find a different one.
 */
export async function findVideos(query: string, limit = 5): Promise<FoundVideo[]> {
  const known = parseVideoInput(query);
  if (known) {
    const details = await call<{
      items?: { id: string; snippet?: { title?: string; channelTitle?: string; publishedAt?: string } }[];
    }>("videos", { part: "snippet", id: known });

    const item = details.items?.[0];
    return [
      {
        id: known,
        title: item?.snippet?.title ?? "that video",
        channel: item?.snippet?.channelTitle ?? "",
        url: watchUrl(known),
        publishedAt: item?.snippet?.publishedAt ?? null,
      },
    ];
  }

  const trimmed = query.trim();
  if (!trimmed) throw new Error("Which video, sir?");

  const found = await call<{ items?: SearchItem[] }>("search", {
    part: "snippet",
    type: "video",
    maxResults: String(Math.max(1, Math.min(limit, 10))),
    q: trimmed,
  });

  return (found.items ?? [])
    .map((item) => ({
      id: item.id?.videoId ?? "",
      title: item.snippet?.title ?? "",
      channel: item.snippet?.channelTitle ?? "",
      url: item.id?.videoId ? watchUrl(item.id.videoId) : "",
      publishedAt: item.snippet?.publishedAt ?? null,
      description: item.snippet?.description ?? "",
    }))
    .filter((video) => video.id)
    .sort((a, b) => rankMatch(b.title, trimmed) - rankMatch(a.title, trimmed));
}

export interface FoundChannel {
  id: string;
  title: string;
  handle: string | null;
  url: string;
  subscribers: number | null;
  videos: number;
}

/**
 * Channels matching a name. A handle, id or URL resolves directly through the
 * same path the statistics use, so "open my channel" and "how's my channel
 * doing" can never disagree about which channel that is.
 */
export async function findChannels(query: string, limit = 5): Promise<FoundChannel[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Which channel, sir?");

  const ref = parseChannelInput(trimmed);
  if (ref && ref.kind !== "search") {
    const stats = await channelStats(trimmed);
    return [
      {
        id: stats.id,
        title: stats.title,
        handle: stats.handle,
        url: stats.handle ? `https://www.youtube.com/${stats.handle}` : stats.url,
        subscribers: stats.subscribers,
        videos: stats.videos,
      },
    ];
  }

  const found = await call<{ items?: SearchItem[] }>("search", {
    part: "snippet",
    type: "channel",
    maxResults: String(Math.max(1, Math.min(limit, 10))),
    q: trimmed,
  });

  const ids = (found.items ?? [])
    .map((item) => item.id?.channelId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  // Search results carry no statistics of their own, and the subscriber count
  // is how you tell the real channel from the impersonations beneath it.
  const details = await call<{ items?: ChannelResource[] }>("channels", {
    part: CHANNEL_PARTS,
    id: ids.join(","),
  });

  return (details.items ?? [])
    .map((channel) => {
      const handle = channel.snippet?.customUrl?.replace(/^@?/, "@") ?? null;
      return {
        id: channel.id,
        title: channel.snippet?.title ?? "Unknown channel",
        handle,
        url: handle
          ? `https://www.youtube.com/${handle}`
          : `https://www.youtube.com/channel/${channel.id}`,
        subscribers: channel.statistics?.hiddenSubscriberCount
          ? null
          : toNumber(channel.statistics?.subscriberCount),
        videos: toNumber(channel.statistics?.videoCount),
      };
    })
    .sort((a, b) => {
      const byName = rankMatch(b.title, trimmed) - rankMatch(a.title, trimmed);
      // Between two equally good name matches, the bigger channel is the one
      // he means — impersonators are always the smaller one.
      return byName !== 0 ? byName : (b.subscribers ?? 0) - (a.subscribers ?? 0);
    });
}
