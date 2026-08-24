import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Everything on this computer, not just the handful written into desktop.ts.
//
// The curated list there exists because Spotify and Discord can be *closed*,
// and searched, and have their own URI schemes — things you can only do if you
// know what the app is. This file is the other half: the long tail. Whatever is
// installed, by whatever name it appears under in the Start menu, openable by
// asking for it.
//
// The security property that makes this safe is worth stating plainly, because
// "let the assistant open anything" sounds like the opposite of safe:
//
//   The model never supplies a path or a command. It supplies a *name*, which
//   is matched against a list the operating system produced, and what gets
//   launched is the identifier Windows itself gave that entry. There is no
//   route from a sentence in a conversation to an arbitrary executable — the
//   worst a wrong answer can do is open the wrong app.

export interface InstalledApp {
  name: string;
  /** What Windows calls it: an AppUserModelID, or a path to a shortcut. */
  id: string;
  /** Where it was found, which is only ever shown to a human. */
  source: "start-menu" | "shortcut" | "desktop-entry";
}

/** Rebuilt no more often than this — scanning is cheap but not free. */
const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; apps: InstalledApp[] } | null = null;

/** Windows' own list of everything in the Start menu, Store apps included. */
async function fromStartApps(): Promise<InstalledApp[]> {
  // Get-StartApps is the same list the Start menu shows, and it returns an
  // AppID for each — including UWP apps, which have no executable to find.
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
    ],
    { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );

  const parsed: unknown = JSON.parse(stdout.trim() || "[]");
  // One app comes back as an object rather than a list of one.
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return entries
    .filter((entry): entry is { Name: string; AppID: string } =>
      Boolean(entry && typeof entry === "object" && (entry as { Name?: string }).Name)
    )
    .map((entry) => ({ name: String(entry.Name), id: String(entry.AppID), source: "start-menu" as const }));
}

/**
 * Shortcuts on disk, as a second pass.
 *
 * Get-StartApps is the better list, but it misses things that were never
 * registered properly — portable apps someone dropped a shortcut to, games
 * added by a launcher — and those are exactly the ones people are surprised he
 * can't open.
 */
function fromShortcuts(): InstalledApp[] {
  const roots = [
    process.env.ProgramData && path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
    process.env.APPDATA && path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(os.homedir(), "Desktop"),
    process.env.PUBLIC && path.join(process.env.PUBLIC, "Desktop"),
  ].filter((root): root is string => Boolean(root));

  const found: InstalledApp[] = [];
  const seen = new Set<string>();

  const walk = (directory: string, depth: number) => {
    if (depth > 4 || found.length > 2000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      // Never followed: a shortcut folder pointing somewhere else is not a
      // place to go wandering.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(lnk|url)$/i.test(entry.name)) continue;
      const name = entry.name.replace(/\.(lnk|url)$/i, "");
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ name, id: full, source: "shortcut" });
    }
  };

  for (const root of roots) walk(root, 0);
  return found;
}

/** The Linux equivalent, so this file isn't Windows-only by accident. */
function fromDesktopEntries(): InstalledApp[] {
  const roots = [
    "/usr/share/applications",
    "/var/lib/flatpak/exports/share/applications",
    path.join(os.homedir(), ".local", "share", "applications"),
  ];

  const found: InstalledApp[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".desktop")) continue;
      let contents: string;
      try {
        contents = fs.readFileSync(path.join(root, file), "utf-8");
      } catch {
        continue;
      }
      if (/^NoDisplay\s*=\s*true/im.test(contents)) continue;
      const name = /^Name\s*=\s*(.+)$/im.exec(contents)?.[1]?.trim();
      if (name) found.push({ name, id: file, source: "desktop-entry" });
    }
  }
  return found;
}

/** Names that are documentation, an uninstaller, or a link to a website. */
const NOISE =
  /^(uninstall|remove |readme|read me|help$|documentation|license|changelog|release notes|.*website$|.*on the web$|.*manual$)/i;

export function dedupe(apps: InstalledApp[]): InstalledApp[] {
  const seen = new Set<string>();
  const kept: InstalledApp[] = [];
  for (const app of apps) {
    const key = app.name.trim().toLowerCase();
    if (!key || seen.has(key) || NOISE.test(app.name)) continue;
    seen.add(key);
    kept.push({ ...app, name: app.name.trim() });
  }
  return kept.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listInstalledApps(force = false): Promise<InstalledApp[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.apps;

  const found: InstalledApp[] = [];
  if (process.platform === "win32") {
    try {
      found.push(...(await fromStartApps()));
    } catch {
      // PowerShell blocked or missing: the shortcut scan still finds most of it.
    }
    found.push(...fromShortcuts());
  } else if (process.platform === "linux") {
    found.push(...fromDesktopEntries());
  }

  const apps = dedupe(found);
  cache = { at: Date.now(), apps };
  return apps;
}

// --- finding the one he meant ---------------------------------------------

// Words that carry no information about which app is wanted. Speech is full of
// them — "open the calculator for me" is four words of packaging around one.
const FILLER = new Set([
  "open", "start", "launch", "run", "please", "the", "a", "an", "my", "for",
  "me", "up", "app", "program", "application", "on", "computer", "now",
]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * How well an app's name answers what he said.
 *
 * Speech gives you "open a dobie photoshop" for Adobe Photoshop, so this has to
 * cope with extra words and near misses — but not so loosely that "notes" opens
 * Notepad++ when Notepad is right there. Exact beats prefix beats contains, and
 * a shorter name wins a tie because it is the more specific match.
 */
export function scoreApp(name: string, query: string): number {
  const app = normalise(name);
  const want = normalise(query);
  if (!app || !want) return 0;

  // Before normalising anything away: "Notepad++" and "Notepad" both come out
  // of normalise() as "notepad", and someone asking for one does not mean the
  // other. A name typed exactly wins outright.
  if (name.trim().toLowerCase() === query.trim().toLowerCase()) return 110;

  if (app === want) return 100;
  if (app.startsWith(`${want} `)) return 85;
  if (app.startsWith(want)) return 80;
  if (app.includes(` ${want} `) || app.endsWith(` ${want}`)) return 70;
  if (app.includes(want)) return 60;

  // Word by word, ignoring the words speech leaves lying around.
  const words = want.split(" ").filter((word) => word && !FILLER.has(word));
  if (words.length === 0) return 0;

  const appWords = app.split(" ").filter(Boolean);
  // "vs" for Visual Studio, "gx" for nothing at all — initials are how people
  // shorten a name they use every day.
  const initials = appWords.map((word) => word[0]).join("");

  const hits = words.filter(
    (word) =>
      app.includes(word) ||
      (word.length >= 3 && appWords.some((appWord) => appWord.startsWith(word))) ||
      (word.length >= 2 && initials.includes(word))
  ).length;

  if (hits === words.length) return 50;
  if (hits > 0) return Math.round((hits / words.length) * 40);
  return 0;
}

export interface AppMatch {
  app: InstalledApp;
  score: number;
}

export function rankApps(apps: InstalledApp[], query: string, limit = 5): AppMatch[] {
  return apps
    .map((app) => ({ app, score: scoreApp(app.name, query) }))
    .filter((match) => match.score >= 40)
    .sort((a, b) => b.score - a.score || a.app.name.length - b.app.name.length)
    .slice(0, limit);
}

// --- opening it ------------------------------------------------------------

/** An AppUserModelID, as opposed to a path to a shortcut. */
function isAppId(id: string): boolean {
  return !path.isAbsolute(id) && !id.endsWith(".desktop");
}

/**
 * Launch one.
 *
 * Note what is *not* here: no shell, and no argument that came from the
 * conversation. `id` is whatever the operating system handed us when it listed
 * its own applications, and the only thing done with it is to hand it back.
 */
export async function launchApp(app: InstalledApp): Promise<void> {
  if (process.platform === "win32") {
    if (isAppId(app.id)) {
      // The AppsFolder shell namespace is how a Store app is started by ID.
      await run("explorer.exe", [`shell:AppsFolder\\${app.id}`], { windowsHide: true }).catch(
        () => undefined
      );
      return;
    }
    // explorer resolves a shortcut the same way double-clicking it does, and
    // it always reports success, so failure is judged by the app appearing.
    await run("explorer.exe", [app.id], { windowsHide: true }).catch(() => undefined);
    return;
  }

  if (process.platform === "darwin") {
    await run("open", ["-a", app.name]);
    return;
  }

  await run("gtk-launch", [app.id.replace(/\.desktop$/, "")]).catch(async () => {
    await run("xdg-open", [app.id]);
  });
}
