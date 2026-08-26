import { getSetting } from "./settings";

// Playlists, by name.
//
// There is no free, key-free way to look a playlist up by name — Spotify's
// search needs a developer app, and your *own* playlists need you to log in to
// one. What there is, and what costs nothing, is a link. Every playlist has
// one, it is two taps to copy, and once Axis has it he can go straight there
// for ever after.
//
// So this works the way the phone contacts and the Zaps do: a list of
// "Name = link" lines you write once. Say the name, land on the playlist. For
// anything not on the list he falls back to opening a Spotify search, and says
// that is what he did rather than pretending to have found it.

export interface Playlist {
  name: string;
  /** The canonical id, when the link carried one. */
  id: string | null;
  /** Where to send a browser. */
  url: string;
  /** Where to send the desktop app, when we know enough to. */
  uri: string | null;
}

/**
 * Pull the id out of whatever form the link was copied in.
 *
 * Spotify hands out three: the share URL with a tracking parameter glued on,
 * the "Copy Spotify URI" form, and — from the older web player — a URL with the
 * owner's username in the middle of it.
 */
export function parsePlaylistId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // spotify:playlist:ID, or the older spotify:user:x:playlist:ID
  const uri = /spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]+)/i.exec(text);
  if (uri) return uri[1];

  // Any open.spotify.com URL with /playlist/ID in the path, whatever precedes it.
  const url = /open\.spotify\.com\/(?:[^/\s]+\/)*playlist\/([A-Za-z0-9]+)/i.exec(text);
  if (url) return url[1];

  // A bare id. Spotify's are 22 base62 characters; being strict here keeps a
  // playlist *name* from being mistaken for an id.
  if (/^[A-Za-z0-9]{22}$/.test(text)) return text;

  return null;
}

function fromId(name: string, id: string): Playlist {
  return {
    name,
    id,
    url: `https://open.spotify.com/playlist/${id}`,
    uri: `spotify:playlist:${id}`,
  };
}

/**
 * Parse the saved list. One per line, "name = link" — the same shape as the
 * phone contacts and the Zaps, so there is one format to learn rather than
 * three.
 *
 * A line whose link isn't a playlist is kept rather than dropped, as long as it
 * is an open.spotify.com address: an album or an artist is a perfectly
 * reasonable thing to want by name, and refusing it would be pedantry.
 */
export function parsePlaylists(raw: string | undefined): Playlist[] {
  if (!raw) return [];

  return raw
    .split(/\r?\n+/)
    .map((line) => {
      const at = line.indexOf("=");
      if (at === -1) return null;
      const name = line.slice(0, at).trim();
      const link = line.slice(at + 1).trim();
      if (!name || !link) return null;

      const id = parsePlaylistId(link);
      if (id) return fromId(name, id);

      // Not a playlist, but still a Spotify address.
      if (/^https:\/\/open\.spotify\.com\//i.test(link)) {
        return { name, id: null, url: link, uri: null };
      }
      return null;
    })
    .filter((entry): entry is Playlist => entry !== null);
}

export function savedPlaylists(): Playlist[] {
  return parsePlaylists(getSetting("SPOTIFY_PLAYLISTS"));
}

/** Words that surround a playlist's name without being part of it. */
const FILLER = new Set([
  "open", "play", "put", "on", "my", "the", "a", "please", "playlist",
  "spotify", "up", "some", "go", "to", "start",
]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function keywords(text: string): string[] {
  return normalise(text)
    .split(" ")
    // Two characters minimum. Without it, the "I" in "something I never saved"
    // is a substring of "late night driving" and matches it — which is how a
    // sentence about nothing in particular opens a playlist at random.
    .filter((word) => word.length >= 2 && !FILLER.has(word));
}

/**
 * Which saved playlist he meant.
 *
 * "Put my workout playlist on" has one word in it that identifies anything, and
 * that is the word to match. An exact name still wins outright, so a playlist
 * genuinely called "Playlist" is reachable.
 */
export function findPlaylist(playlists: Playlist[], query: string): Playlist | null {
  const asked = normalise(query);
  if (!asked) return null;

  const exact = playlists.find((playlist) => normalise(playlist.name) === asked);
  if (exact) return exact;

  const words = keywords(query);
  if (words.length === 0) return null;

  const scored = playlists
    .map((playlist) => {
      const name = normalise(playlist.name);
      const nameWords = new Set(name.split(" "));
      let score = 0;
      for (const word of words) {
        if (nameWords.has(word)) score += 2;
        // A substring only counts for a real word: three characters or more,
        // so "on" inside "London" is not evidence of anything.
        else if (word.length >= 3 && name.includes(word)) score += 1;
      }
      // Every word of the name accounted for is a better match than one word
      // of five, so reward covering the name as well as the query.
      return { playlist, score: score / Math.max(1, nameWords.size) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.playlist ?? null;
}

export interface PlaylistDestination {
  url: string;
  uri: string | null;
  /** True when this is the playlist itself rather than a page of results. */
  exact: boolean;
  name?: string;
}

/**
 * Where to send him for a playlist.
 *
 * The saved list first, then whatever he said in case it was a link, and
 * finally a Spotify search. That last one is deliberately the plain search
 * page rather than a filtered one: Spotify's web player does have per-type
 * tabs, but I could not reach the site to confirm the URL for them, and a
 * guessed path that 404s is worse than a search page that works.
 */
export function playlistDestination(query: string): PlaylistDestination | null {
  const asked = query.trim();
  if (!asked) return null;

  const saved = findPlaylist(savedPlaylists(), asked);
  if (saved) {
    return { url: saved.url, uri: saved.uri, exact: true, name: saved.name };
  }

  const id = parsePlaylistId(asked);
  if (id) {
    const playlist = fromId(asked, id);
    return { url: playlist.url, uri: playlist.uri, exact: true };
  }

  const terms = keywords(asked).join(" ") || normalise(asked);
  return {
    url: `https://open.spotify.com/search/${encodeURIComponent(terms)}`,
    uri: `spotify:search:${encodeURIComponent(terms)}`,
    exact: false,
  };
}
