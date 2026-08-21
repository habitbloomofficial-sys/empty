// Recognising a video someone has already identified, so no search is needed.
//
// A pasted link, a share link, a Shorts link, or the bare id — all of them
// name one exact video, and going to the API to "find" it would be slower,
// cost quota, and could still come back with something else. Pure, so every
// form can be tested directly.

/** Video ids are always 11 characters of base64url. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/**
 * The video id inside whatever was given, or null if it names no particular
 * video and will have to be searched for.
 */
export function parseVideoInput(raw: string): string | null {
  const trimmed = (raw ?? "").trim().replace(/^["'`<]|["'`>]$/g, "");
  if (!trimmed) return null;
  if (isVideoId(trimmed)) return trimmed;

  const urlText =
    trimmed.match(/https?:\/\/\S+/i)?.[0] ??
    (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(trimmed) ? `https://${trimmed}` : null);
  if (!urlText) return null;

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!/^(m\.)?youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return null;

  // youtu.be/ID — the share link, where the id is the whole path.
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && isVideoId(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && isVideoId(v)) return v;

  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  const segments = url.pathname.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    if (!["shorts", "embed", "live", "v"].includes(segments[i].toLowerCase())) continue;
    const id = segments[i + 1];
    if (id && isVideoId(id)) return id;
  }

  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
