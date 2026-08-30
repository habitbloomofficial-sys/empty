import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { channelStats, configuredChannel, findChannels, isYouTubeConfigured } from "./youtube";

// Who else is making what he makes.
//
// A channel is not run in a vacuum. The useful question is never "how many
// subscribers do I have" — he knows that — it is "how am I doing against the
// people making the same thing", and that needs two things this file provides:
// a way to find them, and a memory of where they were last time, so the number
// that matters (the change) can be worked out at all.
//
// Everything here is public YouTube data: the counts anyone sees on the page.

const STORE = path.join(process.cwd(), "data", "competitors.json");

export interface Rival {
  id: string;
  title: string;
  handle: string | null;
  url: string;
  /** Null when a channel hides its count, which is allowed and not rare. */
  subscribers: number | null;
  videos: number;
  views: number;
  addedAt: number;
  /** Where they stood when he was last told, so a change can be reported. */
  lastTold?: { subscribers: number | null; views: number; at: number };
}

interface Store {
  rivals: Rival[];
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf-8")) as Store;
    return { rivals: Array.isArray(parsed.rivals) ? parsed.rivals : [] };
  } catch {
    return { rivals: [] };
  }
}

function write(store: Store): void {
  try {
    writeFileAtomic(STORE, JSON.stringify(store, null, 2));
  } catch {
    // A list that can't be saved is still usable for this conversation.
  }
}

export function trackedRivals(): Rival[] {
  return read().rivals;
}

export function isCompetitorTrackingAvailable(): boolean {
  return isYouTubeConfigured();
}

/** Loose matching, so "chessbase" finds "ChessBase India". */
function matches(rival: Rival, query: string): boolean {
  const asked = query.trim().toLowerCase();
  if (!asked) return false;
  return (
    rival.id.toLowerCase() === asked ||
    rival.handle?.toLowerCase() === asked ||
    rival.handle?.toLowerCase() === `@${asked}` ||
    rival.title.toLowerCase() === asked ||
    rival.title.toLowerCase().includes(asked)
  );
}

export interface Found {
  id: string;
  title: string;
  handle: string | null;
  url: string;
  subscribers: number | null;
  videos: number;
  /** Already on his list. */
  tracked: boolean;
}

/**
 * Channels making the same thing he does.
 *
 * His own channel is filtered out — it is the thing being compared, not a
 * competitor — and the results are ordered by size, because that is the order
 * anyone actually wants to see rivals in.
 */
export async function findRivals(topic: string, limit = 6): Promise<Found[]> {
  const mine = configuredChannel();
  let own: string | null = null;
  if (mine) {
    try {
      own = (await channelStats()).id;
    } catch {
      own = null;   // Can't identify his own channel; just don't filter it.
    }
  }

  const tracked = new Set(trackedRivals().map((rival) => rival.id));
  const found = await findChannels(topic, Math.min(10, Math.max(limit, 3)));

  return found
    .filter((channel) => channel.id !== own)
    .sort((a, b) => (b.subscribers ?? -1) - (a.subscribers ?? -1))
    .slice(0, limit)
    .map((channel) => ({
      id: channel.id,
      title: channel.title,
      handle: channel.handle,
      url: channel.url,
      subscribers: channel.subscribers,
      videos: channel.videos,
      tracked: tracked.has(channel.id),
    }));
}

/** Put one on the list, by handle, id, URL or name. */
export async function trackRival(channel: string): Promise<Rival> {
  const stats = await channelStats(channel);
  const store = read();

  const already = store.rivals.find((rival) => rival.id === stats.id);
  if (already) {
    // Refresh rather than duplicate: asking twice should update, not double up.
    Object.assign(already, {
      title: stats.title,
      handle: stats.handle,
      subscribers: stats.subscribers,
      videos: stats.videos,
      views: stats.views,
    });
    write(store);
    return already;
  }

  const rival: Rival = {
    id: stats.id,
    title: stats.title,
    handle: stats.handle,
    url: stats.handle ? `https://www.youtube.com/${stats.handle}` : stats.url,
    subscribers: stats.subscribers,
    videos: stats.videos,
    views: stats.views,
    addedAt: Date.now(),
  };
  store.rivals.push(rival);
  write(store);
  return rival;
}

/** Take one off. Returns what was removed, or null if it wasn't there. */
export function untrackRival(query: string): Rival | null {
  const store = read();
  const index = store.rivals.findIndex((rival) => matches(rival, query));
  if (index === -1) return null;
  const [removed] = store.rivals.splice(index, 1);
  write(store);
  return removed;
}

export interface Standing {
  title: string;
  handle: string | null;
  url: string;
  subscribers: number | null;
  videos: number;
  views: number;
  /** Since he was last told. Null the first time, when there is no "before". */
  subscriberChange: number | null;
  viewChange: number | null;
  /** How long ago that was, in days. */
  sinceDays: number | null;
}

export interface Report {
  mine: Standing | null;
  rivals: Standing[];
}

function standing(
  current: { title: string; handle: string | null; url: string; subscribers: number | null; videos: number; views: number },
  lastTold?: { subscribers: number | null; views: number; at: number }
): Standing {
  const subscriberChange =
    lastTold && lastTold.subscribers !== null && current.subscribers !== null
      ? current.subscribers - lastTold.subscribers
      : null;
  return {
    title: current.title,
    handle: current.handle,
    url: current.url,
    subscribers: current.subscribers,
    videos: current.videos,
    views: current.views,
    subscriberChange,
    viewChange: lastTold ? current.views - lastTold.views : null,
    sinceDays: lastTold ? Math.round((Date.now() - lastTold.at) / 86_400_000) : null,
  };
}

/**
 * Where everyone stands, and what has moved.
 *
 * Fetches fresh numbers for every tracked channel, works out the change since
 * he last reported, and then records the new numbers as the baseline. That
 * last step is why "since he was last told" means something: the comparison is
 * against the last time he *said* it, not against whenever the entry was made.
 */
export async function standings(record = true): Promise<Report> {
  const store = read();
  const now = Date.now();

  let mine: Standing | null = null;
  if (configuredChannel()) {
    try {
      const stats = await channelStats();
      mine = standing({
        title: stats.title,
        handle: stats.handle,
        url: stats.url,
        subscribers: stats.subscribers,
        videos: stats.videos,
        views: stats.views,
      });
    } catch {
      mine = null;
    }
  }

  const rivals: Standing[] = [];
  for (const rival of store.rivals) {
    try {
      const stats = await channelStats(rival.handle ?? rival.id);
      rivals.push(
        standing(
          {
            title: stats.title,
            handle: stats.handle,
            url: rival.url,
            subscribers: stats.subscribers,
            videos: stats.videos,
            views: stats.views,
          },
          rival.lastTold
        )
      );
      Object.assign(rival, {
        title: stats.title,
        subscribers: stats.subscribers,
        videos: stats.videos,
        views: stats.views,
        // Only when he is actually being told. A background glance that moved
        // the baseline would quietly eat the change before he ever heard it.
        ...(record ? { lastTold: { subscribers: stats.subscribers, views: stats.views, at: now } } : {}),
      });
    } catch {
      // One channel that won't answer — deleted, renamed, rate-limited — must
      // not cost him the rest of the report.
      rivals.push(standing(rival, rival.lastTold));
    }
  }

  if (record) write(store);
  rivals.sort((a, b) => (b.subscribers ?? -1) - (a.subscribers ?? -1));
  return { mine, rivals };
}
