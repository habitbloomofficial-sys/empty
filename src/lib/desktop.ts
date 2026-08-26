import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getSetting } from "./settings";
import { normalizeWebUrl } from "./webUrl";
import { findWebsite, looksLikeDomain } from "./websites";

// Axis runs on your own machine, so he can open desktop apps on it. That is
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

/**
 * Hand a URI to the operating system for whichever app claims the scheme.
 *
 * The character check is the whole safety story here: a URI reaches a
 * registered protocol handler, and some of those on Windows will do far more
 * than open a window if you can get punctuation into them. Everything that
 * gets this far has already been percent-encoded.
 */
export async function openUri(uri: string): Promise<void> {
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

// The apps Axis may open and close. A registry rather than a pile of
// special cases: adding one is a table entry, and nothing anywhere else can
// name an executable or a process to kill.

export type AppId =
  | "spotify"
  | "discord"
  | "chrome"
  | "edge"
  | "firefox"
  | "opera"
  | "explorer"
  | "recyclebin";

interface DesktopApp {
  label: string;
  /** Protocol or shell URI, where one exists. Browsers have none. */
  uri?: string;
  /** Some apps can be opened straight onto a search. */
  search?: (query: string) => string;
  /** Executables to terminate, per platform. Nothing else is ever named. */
  processes: Partial<Record<NodeJS.Platform, string[]>>;
  /** Where to look if the protocol handler isn't registered. */
  paths: () => string[];
  /**
   * Closing it needs something other than ending its process. File Explorer is
   * the case that matters: explorer.exe is also the taskbar, the desktop and
   * the Start menu, so killing it takes Windows' entire shell down with it.
   */
  closer?: () => Promise<boolean>;
  /** A place rather than a program — there is nothing to close. */
  openOnly?: boolean;
}

function windowsPaths(...segments: string[][]): string[] {
  const roots: Record<string, string | undefined> = {
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    programFiles: process.env.ProgramFiles,
    // 32-bit installs on a 64-bit Windows, which is where Chrome and Opera
    // still live on plenty of machines that were set up years ago.
    programFilesX86: process.env["ProgramFiles(x86)"],
  };
  return segments
    .map(([root, ...rest]) => {
      const base = roots[root];
      return base ? path.join(base, ...rest) : "";
    })
    .filter(Boolean);
}

/**
 * Close the File Explorer windows, and only those.
 *
 * explorer.exe is not just the file browser: it is also the taskbar, the
 * desktop and the Start menu. Ending the process closes your folders and takes
 * the entire Windows shell with them. Asking the shell to close its own
 * browser windows leaves everything else standing.
 *
 * The command is a constant. Nothing from a conversation reaches it.
 */
async function closeExplorerWindows(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script =
    "$shell = New-Object -ComObject Shell.Application; " +
    "$windows = @($shell.Windows() | Where-Object { $_.FullName -like '*explorer.exe' }); " +
    "$windows | ForEach-Object { $_.Quit() }; " +
    "$windows.Count";
  const result = await tryRun("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return result.ok;
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
  chrome: {
    label: "Google Chrome",
    processes: { win32: ["chrome.exe"], darwin: ["Google Chrome"], linux: ["chrome", "google-chrome"] },
    paths: () => {
      if (process.platform === "win32") {
        return windowsPaths(
          ["programFiles", "Google", "Chrome", "Application", "chrome.exe"],
          ["programFilesX86", "Google", "Chrome", "Application", "chrome.exe"],
          ["localAppData", "Google", "Chrome", "Application", "chrome.exe"]
        );
      }
      if (process.platform === "darwin") return ["/Applications/Google Chrome.app"];
      return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"];
    },
  },
  edge: {
    label: "Microsoft Edge",
    processes: { win32: ["msedge.exe"], darwin: ["Microsoft Edge"], linux: ["microsoft-edge"] },
    paths: () => {
      if (process.platform === "win32") {
        return windowsPaths(
          ["programFiles", "Microsoft", "Edge", "Application", "msedge.exe"],
          ["programFilesX86", "Microsoft", "Edge", "Application", "msedge.exe"]
        );
      }
      if (process.platform === "darwin") return ["/Applications/Microsoft Edge.app"];
      return ["/usr/bin/microsoft-edge"];
    },
  },
  firefox: {
    label: "Firefox",
    processes: { win32: ["firefox.exe"], darwin: ["firefox"], linux: ["firefox"] },
    paths: () => {
      if (process.platform === "win32") {
        return windowsPaths(
          ["programFiles", "Mozilla Firefox", "firefox.exe"],
          ["programFilesX86", "Mozilla Firefox", "firefox.exe"]
        );
      }
      if (process.platform === "darwin") return ["/Applications/Firefox.app"];
      return ["/usr/bin/firefox", "/snap/bin/firefox"];
    },
  },
  opera: {
    label: "Opera",
    // Opera GX runs as opera.exe too, so one name covers both.
    processes: { win32: ["opera.exe"], darwin: ["Opera"], linux: ["opera"] },
    paths: () => {
      if (process.platform === "win32") {
        return windowsPaths(
          ["localAppData", "Programs", "Opera", "opera.exe"],
          ["localAppData", "Programs", "Opera GX", "opera.exe"],
          ["programFiles", "Opera", "opera.exe"],
          ["programFiles", "Opera GX", "opera.exe"],
          ["programFilesX86", "Opera", "opera.exe"]
        );
      }
      if (process.platform === "darwin") return ["/Applications/Opera.app"];
      return ["/usr/bin/opera"];
    },
  },
  explorer: {
    label: "File Explorer",
    // "This PC" — the same window the taskbar button opens.
    uri: "shell:MyComputerFolder",
    processes: {},
    paths: () => [],
    closer: closeExplorerWindows,
  },
  recyclebin: {
    label: "the Recycle Bin",
    uri: "shell:RecycleBinFolder",
    processes: {},
    paths: () => [],
    openOnly: true,
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
const DEFAULT_SEARCH = "https://www.google.com/search?q=";

/**
 * Browsers that can be told to open a page in a window of its own. Without
 * one of these, a URL handed to the OS lands as another tab in whatever is
 * already open — which is not what "open me a window" means.
 */
/** Browsers Axis can hand a page to, in the order he tries them. */
export const BROWSER_CHOICES = ["chrome", "edge", "firefox", "opera", "brave"] as const;
export type BrowserChoice = (typeof BROWSER_CHOICES)[number];

/**
 * Brave isn't in the apps table — it can't be opened or closed by name, only
 * given a page — so its paths live here rather than there.
 */
function bravePaths(): string[] {
  if (process.platform === "win32") {
    return windowsPaths(
      ["programFiles", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
      ["programFilesX86", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"]
    );
  }
  if (process.platform === "darwin") return ["/Applications/Brave Browser.app"];
  return ["/usr/bin/brave-browser"];
}

function pathsFor(browser: BrowserChoice): string[] {
  if (browser === "brave") return bravePaths();
  // Everywhere else, reuse what the apps table already knows: Opera's two
  // install locations were written down once, for opening Opera itself, and
  // there is no reason for a second copy of them to drift from the first.
  return APPS[browser].paths();
}

/** The browser he's been told to prefer, if it's one he knows. */
export function preferredBrowser(): BrowserChoice | null {
  const configured = getSetting("BROWSER")?.trim().toLowerCase();
  if (!configured || configured === "auto") return null;
  // "opera gx" and "google chrome" are what people actually type.
  const normalised = configured.replace(/\s*gx$/, "").replace(/^google\s+/, "").replace(/\s+browser$/, "");
  return BROWSER_CHOICES.find((name) => name === normalised) ?? null;
}

/**
 * Every browser worth trying, best first.
 *
 * "Best" means the one you asked for. Before this, the list was fixed and
 * Chrome was always at the top of it — so an Opera user watched Axis open
 * YouTube in a browser they don't use, every time, with no way to say
 * otherwise. A chosen browser goes first; the rest stay as fallbacks, because
 * a preference that fails silently when the browser is uninstalled is worse
 * than no preference.
 */
function browserCommands(): { file: string; args: (url: string) => string[] }[] {
  const chosen = preferredBrowser();
  const order: BrowserChoice[] = chosen
    ? [chosen, ...BROWSER_CHOICES.filter((name) => name !== chosen)]
    : [...BROWSER_CHOICES];

  const commands: { file: string; args: (url: string) => string[] }[] = [];
  for (const browser of order) {
    for (const file of pathsFor(browser)) {
      commands.push(
        process.platform === "darwin"
          ? {
              // On macOS the paths are .app bundles, which are opened rather
              // than executed.
              file: "open",
              args: (url: string) => ["-na", file, "--args", "--new-window", url],
            }
          : // Chrome, Edge, Opera and Brave are all Chromium underneath, and
            // Firefox understands --new-window too.
            { file, args: (url: string) => ["--new-window", url] }
      );
    }
  }
  return commands;
}

async function openInNewWindow(url: string): Promise<boolean> {
  for (const { file, args } of browserCommands()) {
    // On Windows and Linux these are real paths or commands; skip missing ones
    // rather than paying for a failed spawn each time.
    if (path.isAbsolute(file) && !fs.existsSync(file)) continue;
    try {
      const child = execFile(file, args(url), { windowsHide: false });
      child.unref();
      return true;
    } catch {
      // Try the next browser.
    }
  }
  return false;
}

export interface OpenWebsiteParams {
  site?: string;
  url?: string;
  query?: string;
  /** Open in a window of its own rather than a tab. Defaults to true. */
  newWindow?: boolean;
}

export interface OpenWebsiteResult {
  opened: boolean;
  url: string;
  /** The site's proper name, when it was one he recognised. */
  site?: string;
  note: string;
}

/**
 * Which address a request actually resolves to, and what to call it.
 *
 * Separated from the opening because this is the part with judgement in it —
 * recognising a name, choosing between a site's front page and a search within
 * it, deciding whether something unknown is an address or a thing to look up —
 * and judgement is what deserves a test. Launching a browser does not.
 */
export interface WebsiteTarget {
  target: string;
  /** The site's proper name, when it was recognised. */
  label?: string;
  /** True when we gave up on a name and searched the web for it instead. */
  searched: boolean;
}

export function resolveWebsiteTarget(params: OpenWebsiteParams): WebsiteTarget {
  const query = params.query?.trim();
  const spoken = params.site?.trim();
  // Recognised by name, however it was said: "chat gpt", "one drive", "the
  // Wikipedia website" all land on the right place. See websites.ts.
  const known = spoken ? findWebsite(spoken) : null;

  let target: string;
  let label: string | undefined;

  if (known) {
    target = query && known.search ? `${known.search}${strictEncode(query)}` : known.home;
    label = known.name;
  } else if (params.url?.trim()) {
    const url = params.url.trim();
    // A URL might still name something known — "open docs.google.com".
    const recognised = findWebsite(url);
    target = url;
    label = recognised?.name;
  } else if (spoken) {
    // Not in the directory. An address is opened as one; a name we don't know
    // is searched for rather than guessed at, because guessing at a domain is
    // how you end up on somebody's parked typo of the site you wanted.
    target = looksLikeDomain(spoken) ? spoken : `${DEFAULT_SEARCH}${strictEncode(spoken)}`;
  } else if (query) {
    target = `${DEFAULT_SEARCH}${strictEncode(query)}`;
  } else {
    throw new Error("Which website would you like open, sir?");
  }

  return { target, label, searched: target.startsWith(DEFAULT_SEARCH) };
}

export async function openWebsite(params: OpenWebsiteParams): Promise<OpenWebsiteResult> {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Opening things on this computer is switched off, sir — enable it in Settings if you'd like it back."
    );
  }

  const { target, label } = resolveWebsiteTarget(params);
  const known = params.site ? findWebsite(params.site) : null;
  const query = params.query?.trim();

  const url = normalizeWebUrl(target);

  // A window of its own by default — that's what's usually wanted of an
  // assistant, and it doesn't disturb whatever you already had open.
  const inWindow = params.newWindow !== false && (await openInNewWindow(url));
  if (!inWindow) await launch(url);

  return {
    opened: true,
    url,
    site: label,
    note: `Opened ${label ?? url}${query && known?.search ? ` on a search for "${query}"` : ""} in ${
      inWindow ? "a new browser window" : "your browser"
    }.`,
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

  // Browsers register no protocol of their own, so there is nothing to open
  // but the executable.
  if (!uri) {
    if (!(await launchInstalled(app))) {
      throw new Error(
        `I couldn't find ${app.label} on this machine, sir — is it installed?`
      );
    }
    return { app: id, note: `Opened ${app.label}.` };
  }

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

  if (app.openOnly) {
    throw new Error(`${app.label} is a folder, sir — close its window yourself.`);
  }

  if (app.closer) {
    if (await app.closer()) return { app: id, note: `Closed ${app.label}.` };
    throw new Error(`I couldn't close ${app.label}, sir.`);
  }

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

/**
 * Open a local file or folder with whatever application the OS has registered
 * for it.
 *
 * The path is not validated here, deliberately: it must already have come back
 * from a search inside an allowed root (see resolveInsideRoots in files.ts).
 * Keeping the check there means there is exactly one place that decides what
 * is reachable, rather than two that can disagree. What this side guarantees
 * is that the path stays one argument — execFile takes an array, so no shell
 * ever sees it and nothing in a filename can become a command.
 */
/**
 * Whether the Spotify desktop app is actually here.
 *
 * A `spotify:` URI is the nicer way in when the app exists and a dead end when
 * it doesn't — Windows answers with "no app is associated with this link",
 * which reads as Axis being broken. So the choice is made by looking.
 */
export function isSpotifyInstalled(): boolean {
  return APPS.spotify.paths().some((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

export async function openLocalPath(target: string): Promise<void> {
  requireDesktopControl();
  await launch(target);
}
