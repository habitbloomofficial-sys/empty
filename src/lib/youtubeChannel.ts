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
