import { getSetting } from "./settings";

// Discord servers, by name.
//
// A Discord server is not a public thing you can look up. It has no address
// anyone can guess, no search that reaches it, and no API that will name it
// without a bot token and an invitation — which is the point of Discord. What
// every server does have is a link: the invite you joined by, or the URL in the
// address bar when you are looking at it.
//
// So this works the way the Spotify playlists and the phone contacts do: a list
// of "Name = link" lines written once. Say the name, land in the server. For a
// name he hasn't saved, Axis opens Discord itself and says plainly that he
// doesn't have a link for it — there is no honest search to fall back on, and a
// guessed URL that lands on nothing is worse than an admission.

export type ServerKind = "channel" | "invite";

export interface DiscordServer {
  name: string;
  /** Where to send a browser. */
  url: string;
  /** Where to send the desktop app, when we know enough to. */
  uri: string | null;
  /**
   * A channel link goes straight into a server he is already in. An invite may
   * land him on a "Join server" page instead, which is worth saying out loud.
   */
  kind: ServerKind;
}

// Snowflakes are 17-19 digits today and were shorter early on; the range is
// deliberately loose, because the only thing riding on it is whether we build a
// URL or decline to.
const SNOWFLAKE = /^[0-9]{5,25}$/;
// Invite codes are the vanity URL or a short random string. Discord allows
// letters, digits and a couple of separators, nothing else.
const INVITE_CODE = /^[A-Za-z0-9_-]{2,64}$/;

export interface DiscordLink {
  url: string;
  uri: string | null;
  kind: ServerKind;
}

/**
 * Read whatever form the link was copied in.
 *
 * Discord hands out several: the invite (discord.gg/x, or /invite/x on the main
 * domain), the address bar when you are in a channel, the older discordapp.com
 * domain, and the desktop client's own discord:// deep link.
 */
export function parseDiscordLink(raw: string): DiscordLink | null {
  const text = raw.trim();
  if (!text) return null;

  // .../channels/GUILD/CHANNEL — the address bar, or a discord:// deep link.
  // The @me form is his direct messages rather than a server, so it is not a
  // destination this looks for.
  const channels = /(?:discord(?:app)?\.com|discord:\/\/-?)\/channels\/([0-9]+)(?:\/([0-9]+))?/i.exec(text);
  if (channels) {
    const guild = channels[1];
    const channel = channels[2];
    if (!SNOWFLAKE.test(guild)) return null;
    if (channel && !SNOWFLAKE.test(channel)) return null;
    const tail = channel ? `${guild}/${channel}` : guild;
    return {
      url: `https://discord.com/channels/${tail}`,
      uri: `discord://-/channels/${tail}`,
      kind: "channel",
    };
  }

  // An invite, in any of the shapes Discord has used for it.
  const invite =
    /(?:discord\.gg|discord(?:app)?\.com\/invite|discord:\/\/-?\/invite)\/([A-Za-z0-9_-]+)/i.exec(text);
  if (invite && INVITE_CODE.test(invite[1])) {
    // Invites stay in the browser deliberately. discord.gg shows a proper
    // preview of the server with an "Open Discord" button on it, which is a
    // better place to land than a client that may or may not accept the deep
    // link, and it is the one page that tells him what he is about to join.
    return { url: `https://discord.gg/${invite[1]}`, uri: null, kind: "invite" };
  }

  return null;
}

/**
 * Parse the saved list — one per line, "name = link", the same shape as the
 * playlists and the phone contacts, so there is one format to learn.
 */
export function parseServers(raw: string | undefined): DiscordServer[] {
  if (!raw) return [];

  return raw
    .split(/\r?\n+/)
    .map((line) => {
      const at = line.indexOf("=");
      if (at === -1) return null;
      const name = line.slice(0, at).trim();
      const link = line.slice(at + 1).trim();
      if (!name || !link) return null;

      const parsed = parseDiscordLink(link);
      return parsed ? { name, ...parsed } : null;
    })
    .filter((entry): entry is DiscordServer => entry !== null);
}

export function savedServers(): DiscordServer[] {
  return parseServers(getSetting("DISCORD_SERVERS"));
}

/** Words that surround a server's name without being part of it. */
const FILLER = new Set([
  "open", "go", "to", "into", "my", "the", "a", "please", "server",
  "discord", "up", "on", "in", "take", "me", "jump", "guild",
]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function keywords(text: string): string[] {
  return normalise(text)
    .split(" ")
    // Two characters minimum, as with the playlists: a stray single letter is a
    // substring of almost every name, and matching on one opens a server at
    // random from a sentence that named nothing.
    .filter((word) => word.length >= 2 && !FILLER.has(word));
}

/**
 * Which saved server he meant.
 *
 * An exact name wins outright, so a server genuinely called "Server" is still
 * reachable. Otherwise it is the best-covered name: whole words count double,
 * and a substring only counts for a word of three characters or more.
 */
export function findServer(servers: DiscordServer[], query: string): DiscordServer | null {
  const asked = normalise(query);
  if (!asked) return null;

  const exact = servers.find((server) => normalise(server.name) === asked);
  if (exact) return exact;

  const words = keywords(query);
  if (words.length === 0) return null;

  const scored = servers
    .map((server) => {
      const name = normalise(server.name);
      const nameWords = new Set(name.split(" "));
      let score = 0;
      for (const word of words) {
        if (nameWords.has(word)) score += 2;
        else if (word.length >= 3 && name.includes(word)) score += 1;
      }
      return { server, score: score / Math.max(1, nameWords.size) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.server ?? null;
}

export interface ServerDestination {
  url: string;
  uri: string | null;
  /** True when this is the server itself rather than Discord's front door. */
  exact: boolean;
  name?: string;
  kind?: ServerKind;
}

/** Discord with nothing particular open: his direct messages. */
const FRONT_DOOR: ServerDestination = {
  url: "https://discord.com/channels/@me",
  // The bare scheme, not a path: it opens the client wherever he left it, and
  // it is the one discord:// URI that is certain to be understood.
  uri: "discord://",
  exact: false,
};

/**
 * Where to send him for a server.
 *
 * The saved list first, then whatever he said in case he read out a link, and
 * failing both, Discord itself. There is deliberately no search: Discord has no
 * public one that reaches private servers, and inventing a URL that lands on an
 * error page would be a worse answer than saying the name isn't saved.
 */
export function serverDestination(query: string): ServerDestination | null {
  const asked = query.trim();
  if (!asked) return null;

  const saved = findServer(savedServers(), asked);
  if (saved) {
    return { url: saved.url, uri: saved.uri, exact: true, name: saved.name, kind: saved.kind };
  }

  const link = parseDiscordLink(asked);
  if (link) return { url: link.url, uri: link.uri, exact: true, kind: link.kind };

  return FRONT_DOOR;
}
