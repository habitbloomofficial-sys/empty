// Working out which channel someone means. Pure — no network, no config — so
// every form a channel can be written in is settled here and tested directly.
//
// People refer to their own channel in every way it has ever been displayed:
// the @handle, the UC… id, a browser URL, a legacy /user/ path, or just the
// name. Each needs a different YouTube API call, so the first job is to tell
// them apart.

export type ChannelRef =
  /** A canonical channel id — usable directly. */
  | { kind: "id"; value: string }
  /** An @handle — resolvable in one call. */
  | { kind: "handle"; value: string }
  /** A legacy /user/ name from the pre-handle era. */
  | { kind: "username"; value: string }
  /** Anything else: a display name, to be searched for. */
  | { kind: "search"; value: string };

/** Channel ids are always "UC" followed by 22 more base64url characters. */
export function isChannelId(value: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(value);
}

export function parseChannelInput(raw: string): ChannelRef | null {
  const trimmed = raw.trim().replace(/^["'`]|["'`]$/g, "");
  if (!trimmed) return null;

  // A URL carries the answer in its path, and which segment it is tells us
  // which kind of reference it is.
  const urlText = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? (trimmed.includes("youtube.com/") ? `https://${trimmed}` : null);
  if (urlText) {
    try {
      const url = new URL(urlText);
      const segments = url.pathname.split("/").filter(Boolean);
      for (let i = 0; i < segments.length; i++) {
        const segment = decodeURIComponent(segments[i]);
        if (segment === "channel" && segments[i + 1]) {
          const id = decodeURIComponent(segments[i + 1]);
          if (isChannelId(id)) return { kind: "id", value: id };
        }
        if (segment === "user" && segments[i + 1]) {
          return { kind: "username", value: decodeURIComponent(segments[i + 1]) };
        }
        if (segment.startsWith("@") && segment.length > 1) {
          return { kind: "handle", value: segment.slice(1) };
        }
        if (segment === "c" && segments[i + 1]) {
          // The old vanity path. It isn't a handle and isn't an id, so the
          // only reliable way back to a channel is to search for it.
          return { kind: "search", value: decodeURIComponent(segments[i + 1]) };
        }
      }
    } catch {
      // Not a parseable URL; fall through to the plain forms below.
    }
  }

  if (isChannelId(trimmed)) return { kind: "id", value: trimmed };
  if (trimmed.startsWith("@") && trimmed.length > 1) {
    return { kind: "handle", value: trimmed.slice(1) };
  }
  return { kind: "search", value: trimmed };
}

/** How the reference should read back to a person, e.g. in an error. */
export function describeChannelRef(ref: ChannelRef): string {
  if (ref.kind === "id") return ref.value;
  if (ref.kind === "handle") return `@${ref.value}`;
  return ref.value;
}

/**
 * Where to send a browser for a channel, without an API key.
 *
 * Opening a channel used to need a YouTube key, which meant that for anyone
 * without one it simply didn't work. It doesn't need one: a handle is a public
 * URL, and YouTube's own search takes a filter that shows nothing but channels.
 *
 * The distinction that matters is exactness. Given "@MrBeast" we know precisely
 * where to go. Given "Mr Beast" we do not — the temptation is to squash the
 * spaces and guess at youtube.com/@mrbeast, and when the guess is wrong you
 * land on a 404 having been told you were being taken to a channel. So a name
 * opens YouTube's channel results instead, where the right one is almost
 * always first and the wrong one is at least visible. `exact` says which of
 * those happened, so he can say so rather than overclaiming.
 */
export interface ChannelDestination {
  url: string;
  /** True when this is the channel itself rather than a page of candidates. */
  exact: boolean;
}

/**
 * `sp` is YouTube's search-filter token; this value is the "Channels" filter
 * from its own UI, so the results page contains channels and nothing else.
 */
const CHANNELS_ONLY = "EgIQAg%3D%3D";

export function channelDestination(query: string): ChannelDestination | null {
  const ref = parseChannelInput(query);
  if (!ref) return null;

  if (ref.kind === "id") {
    return { url: `https://www.youtube.com/channel/${ref.value}`, exact: true };
  }
  if (ref.kind === "handle") {
    return { url: `https://www.youtube.com/@${encodeURIComponent(ref.value)}`, exact: true };
  }
  if (ref.kind === "username") {
    return { url: `https://www.youtube.com/user/${encodeURIComponent(ref.value)}`, exact: true };
  }

  // A name. Strip the words people put around it — "open the X channel" — so
  // the search is for the channel and not for the sentence.
  const cleaned = ref.value
    .replace(/\b(the|a|an|channel|youtube|open|go|to|pull|up|please|show|me)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const terms = cleaned || ref.value;

  return {
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(terms)}&sp=${CHANNELS_ONLY}`,
    exact: false,
  };
}
