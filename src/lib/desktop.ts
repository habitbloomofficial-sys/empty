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

// The apps JARVIS may open and close. A registry rather than a pile of
// special cases: adding one is a table entry, and nothing anywhere else can
// name an executable or a process to kill.

export type AppId = "spotify" | "discord";

interface DesktopApp {
  label: string;
  /** Protocol URI registered by the installer. */
  uri: string;
  /** Some apps can be opened straight onto a search. */
  search?: (query: string) => string;
  /** Executables to terminate, per platform. Nothing else is ever named. */
  processes: Partial<Record<NodeJS.Platform, string[]>>;
  /** Where to look if the protocol handler isn't registered. */
  paths: () => string[];
}

function windowsPaths(...segments: string[][]): string[] {
  const roots: Record<string, string | undefined> = {
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    programFiles: process.env.ProgramFiles,
  };
  return segments
    .map(([root, ...rest]) => {
      const base = roots[root];
      return base ? path.join(base, ...rest) : "";
    })
    .filter(Boolean);
}

const APPS: Record<AppId, DesktopApp> = {
  spotify: {
    label: "Spotify",
    uri: "spotify:",
    search: (query) => `spotify:search:${strictEncode(query)}`,
    processes: { win32: ["Spotify.exe"], darwin: ["Spotify"], linux: ["spotify"] },
    paths: () => {
      if (process.platform === "win32") {
        return windowsPaths(["appData", "Spotify", "Spotify.exe"], ["programFiles", "Spotify", "Spotify.exe"]);
      }
      if (process.platform === "darwin") return ["/Applications/Spotify.app"];
      return ["/usr/bin/spotify", "/snap/bin/spotify", "/var/lib/flatpak/exports/bin/com.spotify.Client"];
    },
  },
  discord: {
    label: "Discord",
    uri: "discord://",
    processes: { win32: ["Discord.exe"], darwin: ["Discord"], linux: ["Discord", "discord"] },
    paths: () => {
      if (process.platform === "win32") {
        // Discord installs per-user under a versioned folder; Update.exe is the
        // stable launcher that resolves whichever version is current.
        return windowsPaths(["localAppData", "Discord", "Update.exe"]);
      }
      if (process.platform === "darwin") return ["/Applications/Discord.app"];
      return ["/usr/bin/discord", "/snap/bin/discord", "/var/lib/flatpak/exports/bin/com.discordapp.Discord"];
    },
  },
};

export function isKnownApp(id: string): id is AppId {
  return id in APPS;
}

export function appLabel(id: AppId): string {
  return APPS[id].label;
}

/** Start an app from a known install location when its protocol is missing. */
async function launchInstalled(app: DesktopApp): Promise<boolean> {
  for (const candidate of app.paths()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      if (process.platform === "darwin") {
        await run("open", ["-a", candidate]);
      } else {
        // Discord's Update.exe needs telling which app to start.
        const args = candidate.endsWith("Update.exe") ? ["--processStart", "Discord.exe"] : [];
        // Detached, so the app outlives the request that started it.
        const child = execFile(candidate, args, { windowsHide: false });
        child.unref();
      }
      return true;
    } catch {
      // Try the next location.
    }
  }
  return false;
}

interface CommandResult {
  ok: boolean;
  output: string;
}

async function tryRun(file: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await run(file, args);
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}` };
  }
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

export interface AppActionResult {
  app: AppId;
  query?: string;
  note: string;
}

function requireDesktopControl(): void {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Opening and closing apps is switched off, sir — enable it in Settings if you'd like it back."
    );
  }
}

/**
 * Open one of the known apps, optionally landing on a search where it supports
 * one. For Spotify that navigates but does not press play — the protocol can
 * move around the app, and starting playback needs the Web API and an account
 * authorization this doesn't use.
 */
export async function openApp(id: AppId, query?: string): Promise<AppActionResult> {
  requireDesktopControl();

  const app = APPS[id];
  const trimmed = query?.trim();
  const uri = trimmed && app.search ? app.search(trimmed) : app.uri;

  try {
    await openUri(uri);
  } catch {
    // The protocol handler can be missing if the app was installed oddly.
    if (!(await launchInstalled(app))) {
      throw new Error(
        `I couldn't find ${app.label} on this machine, sir — is the desktop app installed?`
      );
    }
    return {
      app: id,
      query: trimmed,
      note: `Opened ${app.label}.${
        trimmed ? " I couldn't jump to a search — its link handler isn't registered." : ""
      }`,
    };
  }

  return {
    app: id,
    query: trimmed,
    note: trimmed
      ? `Opened ${app.label} with a search for "${trimmed}". Press play on whichever result you want.`
      : `Opened ${app.label}.`,
  };
}

/**
 * Quit one of the known apps. Only the executables named in the registry are
 * ever targeted — nothing from a conversation reaches this as a process name.
 *
 * Asked politely first, then insisted upon: Spotify closes on request, but
 * Discord treats a close as "minimise to tray" and only actually quits when
 * forced.
 */
export async function closeApp(id: AppId): Promise<AppActionResult> {
  requireDesktopControl();

  const app = APPS[id];
  const names = app.processes[process.platform] ?? [];
  if (names.length === 0) {
    throw new Error(`I don't know how to close ${app.label} on this system, sir.`);
  }

  let closed = false;
  let wasRunning = false;

  for (const name of names) {
    if (process.platform === "win32") {
      // /T takes the helper processes down with the main window.
      const polite = await tryRun("taskkill.exe", ["/IM", name, "/T"]);
      if (polite.ok) {
        closed = true;
        wasRunning = true;
      } else if (!/not found|no tasks|not running/i.test(polite.output)) {
        wasRunning = true;
      }

      const forced = await tryRun("taskkill.exe", ["/IM", name, "/T", "/F"]);
      if (forced.ok) {
        closed = true;
        wasRunning = true;
      }
    } else if (process.platform === "darwin") {
      const quit = await tryRun("osascript", ["-e", `quit app "${app.label}"`]);
      if (quit.ok) {
        closed = true;
        wasRunning = true;
      }
    } else {
      const killed = await tryRun("pkill", ["-x", name]);
      if (killed.ok) {
        closed = true;
        wasRunning = true;
      }
    }
  }

  if (!closed && !wasRunning) {
    return { app: id, note: `${app.label} wasn't running, sir.` };
  }
  if (!closed) {
    throw new Error(`I couldn't close ${app.label}, sir — it refused to quit.`);
  }
  return { app: id, note: `Closed ${app.label}.` };
}
