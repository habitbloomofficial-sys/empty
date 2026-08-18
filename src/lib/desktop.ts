import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getSetting } from "./settings";

// JARVIS runs on your own machine, so he can open desktop apps on it. That is
// also why this file is deliberately narrow: the model can ask for exactly the
// actions enumerated here and nothing else. There is no "run this command"
// path, no shell, and no way for text from a conversation to become an
// argument that isn't first encoded down to a known-safe alphabet.

const run = promisify(execFile);

/** After encoding, a launch target may contain only these characters. */
const SAFE_URI = /^[A-Za-z0-9:%._~-]+$/;

export function isDesktopControlEnabled(): boolean {
  // On by default: the only thing it can do is open Spotify.
  return (getSetting("DESKTOP_CONTROL") ?? "on").toLowerCase() !== "off";
}

/**
 * Percent-encode everything outside the RFC 3986 unreserved set. Stricter than
 * encodeURIComponent, which leaves !*'() intact — characters that mean
 * something to a Windows command interpreter.
 */
function strictEncode(value: string): string {
  return Array.from(Buffer.from(value, "utf-8"))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-_.~]/.test(char)
        ? char
        : `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    })
    .join("");
}

async function openUri(uri: string): Promise<void> {
  if (!SAFE_URI.test(uri)) {
    throw new Error("Refusing to open that — it isn't a recognised Spotify link.");
  }
  await launch(uri);
}

/**
 * Hand a validated target to the OS to open with its default handler.
 *
 * On Windows this goes through explorer.exe rather than `cmd /c start`.
 * cmd parses its own command line, and `&` — which every URL with more than
 * one query parameter contains — is a command separator there. explorer.exe is
 * a plain executable, so execFile's argument array reaches it intact and
 * nothing gets a chance to reinterpret it as a command.
 */
async function launch(target: string): Promise<void> {
  if (process.platform === "win32") {
    // explorer.exe often exits non-zero even when it opened the target, so
    // only a failure to start the process itself counts as an error.
    try {
      await run("explorer.exe", [target]);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        await run("rundll32.exe", ["url.dll,FileProtocolHandler", target]);
      }
    }
  } else if (process.platform === "darwin") {
    await run("open", [target]);
  } else {
    await run("xdg-open", [target]);
  }
}

/** Known install locations, tried if the spotify: protocol isn't registered. */
function spotifyExecutables(): string[] {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles;
    return [
      appData ? path.join(appData, "Spotify", "Spotify.exe") : "",
      programFiles ? path.join(programFiles, "Spotify", "Spotify.exe") : "",
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return ["/Applications/Spotify.app"];
  }
  return ["/usr/bin/spotify", "/snap/bin/spotify", "/var/lib/flatpak/exports/bin/com.spotify.Client"];
}

async function launchInstalledSpotify(): Promise<boolean> {
  for (const candidate of spotifyExecutables()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      if (process.platform === "darwin") {
        await run("open", ["-a", candidate]);
      } else {
        // Detached so Spotify outlives the request that started it.
        const child = execFile(candidate, [], { windowsHide: false });
        child.unref();
      }
      return true;
    } catch {
      // Try the next location.
    }
  }
  return false;
}

// Sites worth knowing by name, so "search YouTube for X" lands on results
// rather than a home page. Anything not listed still works — the model passes
// a URL instead — this is just for accuracy on the common ones.
const KNOWN_SITES: Record<string, { home: string; search?: string }> = {
  youtube: { home: "https://www.youtube.com", search: "https://www.youtube.com/results?search_query=" },
  google: { home: "https://www.google.com", search: "https://www.google.com/search?q=" },
  maps: { home: "https://www.google.com/maps", search: "https://www.google.com/maps/search/" },
  gmail: { home: "https://mail.google.com" },
  drive: { home: "https://drive.google.com" },
  calendar: { home: "https://calendar.google.com" },
  wikipedia: { home: "https://en.wikipedia.org", search: "https://en.wikipedia.org/w/index.php?search=" },
  github: { home: "https://github.com", search: "https://github.com/search?q=" },
  reddit: { home: "https://www.reddit.com", search: "https://www.reddit.com/search/?q=" },
  x: { home: "https://x.com", search: "https://x.com/search?q=" },
  twitter: { home: "https://x.com", search: "https://x.com/search?q=" },
  linkedin: { home: "https://www.linkedin.com", search: "https://www.linkedin.com/search/results/all/?keywords=" },
  netflix: { home: "https://www.netflix.com", search: "https://www.netflix.com/search?q=" },
  imdb: { home: "https://www.imdb.com", search: "https://www.imdb.com/find/?q=" },
  amazon: { home: "https://www.amazon.com", search: "https://www.amazon.com/s?k=" },
  spotify: { home: "https://open.spotify.com", search: "https://open.spotify.com/search/" },
  chatgpt: { home: "https://chatgpt.com" },
  claude: { home: "https://claude.ai" },
  dr: { home: "https://www.dr.dk" },
  translate: { home: "https://translate.google.com", search: "https://translate.google.com/?text=" },
};

const DEFAULT_SEARCH = "https://www.google.com/search?q=";

/**
 * Addresses that shouldn't be reachable this way. A browser opening a page on
 * your own machine or router is a different thing from opening a public site,
 * and it isn't what "open a website" is ever meant to mean.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Parse and normalise a web address, refusing anything that isn't a plain
 * public http(s) page.
 *
 * The scheme check is the important one. Windows resolves URIs like
 * `ms-msdt:` or `search-ms:` through registered protocol handlers, some of
 * which have been used to execute code; `file:` reads local disk and
 * `javascript:`/`data:` run in the browser. Only http and https ever get
 * through here.
 */
export function normalizeWebUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("No website given, sir.");

  // A bare domain like "bbc.co.uk" is what people say; assume https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`"${input}" doesn't look like a website address, sir.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `I'll only open ordinary web pages, sir — "${url.protocol}" isn't one.`
    );
  }
  if (url.username || url.password) {
    throw new Error("I won't open a link with a username and password baked into it, sir.");
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new Error(`"${input}" doesn't look like a website address, sir.`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("That address is on this machine or your local network, sir — I'll leave it be.");
  }

  // URL.toString() percent-encodes spaces and non-ASCII and punycodes the
  // host, so what leaves here is always printable ASCII with no whitespace.
  const normalized = url.toString();
  if (!/^[\x21-\x7E]+$/.test(normalized)) {
    throw new Error("That address contains characters I won't pass on, sir.");
  }
  return normalized;
}

export interface OpenWebsiteParams {
  site?: string;
  url?: string;
  query?: string;
}

export interface OpenWebsiteResult {
  opened: boolean;
  url: string;
  note: string;
}

export async function openWebsite(params: OpenWebsiteParams): Promise<OpenWebsiteResult> {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Opening things on this computer is switched off, sir — enable it in Settings if you'd like it back."
    );
  }

  const query = params.query?.trim();
  const siteKey = params.site?.trim().toLowerCase().replace(/^www\./, "").replace(/\.com$/, "");
  const known = siteKey ? KNOWN_SITES[siteKey] : undefined;

  let target: string;
  if (known) {
    target =
      query && known.search
        ? `${known.search}${strictEncode(query)}`
        : known.home;
  } else if (params.url?.trim()) {
    target = params.url.trim();
  } else if (params.site?.trim()) {
    // An unknown site name: treat it as a domain if it looks like one,
    // otherwise search the web for it.
    const site = params.site.trim();
    target = /\.[a-z]{2,}$/i.test(site) ? site : `${DEFAULT_SEARCH}${strictEncode(site)}`;
  } else if (query) {
    target = `${DEFAULT_SEARCH}${strictEncode(query)}`;
  } else {
    throw new Error("Which website would you like open, sir?");
  }

  const url = normalizeWebUrl(target);
  await launch(url);

  return {
    opened: true,
    url,
    note: `Opened ${url} in your browser.`,
  };
}

export interface OpenSpotifyResult {
  opened: boolean;
  query?: string;
  note: string;
}

/**
 * Open the Spotify desktop app, optionally landing on a search. Playback isn't
 * started — the `spotify:` protocol can navigate the app but not press play,
 * which needs the Spotify Web API and an account authorization.
 */
export async function openSpotify(query?: string): Promise<OpenSpotifyResult> {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Opening desktop apps is switched off, sir — enable it in Settings if you'd like it back."
    );
  }

  const trimmed = query?.trim();
  const uri = trimmed ? `spotify:search:${strictEncode(trimmed)}` : "spotify:";

  try {
    await openUri(uri);
  } catch {
    // The protocol handler can be missing if Spotify was installed oddly.
    const launched = await launchInstalledSpotify();
    if (!launched) {
      throw new Error(
        "I couldn't find Spotify on this machine, sir — is the desktop app installed?"
      );
    }
    return {
      opened: true,
      query: trimmed,
      note: "Opened Spotify. I couldn't jump to a search — the spotify: link handler isn't registered.",
    };
  }

  return {
    opened: true,
    query: trimmed,
    note: trimmed
      ? `Opened Spotify with a search for "${trimmed}". Press play on whichever result you want.`
      : "Opened Spotify.",
  };
}
