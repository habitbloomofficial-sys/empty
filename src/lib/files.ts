import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalPath } from "./desktop";
import { getSetting } from "./settings";
import {
  formatBytes,
  kindOf,
  matchScore,
  matchesKind,
  parseRoots,
  shouldSkipDirectory,
} from "./fileSearch";

// Finding things in your own folders.
//
// The same discipline as desktop.ts: there is no "list this path" tool and no
// way for a sentence in a conversation to name an arbitrary directory. Search
// happens inside a fixed set of roots — your personal folders, plus anything
// you add yourself in Settings — and a file can only be opened if it was found
// under one of them. Contents are never read; this answers "where is it", not
// "what's in it".

/** The personal folders worth searching, in the order people think of them. */
const HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"];

export interface SearchRoot {
  label: string;
  path: string;
}

function realDirectory(candidate: string): string | null {
  try {
    const resolved = fs.realpathSync(candidate);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Every folder Axis may look in. Anything outside this list is invisible to
 * him — not filtered out of the results, never visited.
 */
export function searchRoots(): SearchRoot[] {
  const home = os.homedir();
  const roots: SearchRoot[] = [];
  const seen = new Set<string>();

  const add = (label: string, candidate: string) => {
    const resolved = realDirectory(candidate);
    if (!resolved || seen.has(resolved.toLowerCase())) return;
    seen.add(resolved.toLowerCase());
    roots.push({ label, path: resolved });
  };

  for (const folder of HOME_FOLDERS) add(folder, path.join(home, folder));
  // OneDrive redirects the personal folders on a lot of Windows installs, and
  // the originals are then empty — so look in both places.
  const oneDrive = path.join(home, "OneDrive");
  if (realDirectory(oneDrive)) {
    for (const folder of HOME_FOLDERS) add(`OneDrive ${folder}`, path.join(oneDrive, folder));
  }
  for (const extra of parseRoots(getSetting("FILE_SEARCH_ROOTS"))) {
    add(path.basename(extra) || extra, extra);
  }

  return roots;
}

export function isFileSearchEnabled(): boolean {
  return (getSetting("DESKTOP_CONTROL") ?? "on").toLowerCase() !== "off" && searchRoots().length > 0;
}

/**
 * The absolute path, but only if it sits inside a root. Everything that opens
 * a file goes through here, so a path that came back from somewhere other than
 * a search cannot be opened.
 */
export function resolveInsideRoots(candidate: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(candidate));
  } catch {
    throw new Error(`There's no file at ${candidate}, sir.`);
  }

  const roots = searchRoots();
  const inside = roots.some((root) => {
    const relative = path.relative(root.path, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });

  if (!inside) {
    throw new Error(
      `That's outside the folders I'm allowed to look in, sir. I can reach: ${roots.map((r) => r.label).join(", ")}.`
    );
  }
  return resolved;
}

export interface FileMatch {
  name: string;
  path: string;
  folder: string;
  kind: string;
  size: string;
  modified: string;
}

export interface SearchOutcome {
  matches: FileMatch[];
  searched: string[];
  scanned: number;
  /** True when the budget ran out before the folders did. */
  truncated: boolean;
}

interface SearchOptions {
  query: string;
  folder?: string;
  kind?: string;
  limit?: number;
}

// A search happens while someone is waiting mid-conversation, so it is bounded
// three ways. Whichever runs out first ends the walk, and the answer says so
// rather than pretending it saw everything.
const MAX_DIRECTORIES = 6000;
const MAX_DEPTH = 8;
const TIME_BUDGET_MS = 6000;

/** Narrow the search to one named folder, if he named one. */
function rootsFor(folder: string | undefined): SearchRoot[] {
  const all = searchRoots();
  if (!folder?.trim()) return all;

  const wanted = folder.trim().toLowerCase().replace(/[\\/]+$/, "");
  const byLabel = all.filter(
    (root) => root.label.toLowerCase() === wanted || path.basename(root.path).toLowerCase() === wanted
  );
  if (byLabel.length > 0) return byLabel;

  // An absolute path is fine so long as it's inside a root.
  if (path.isAbsolute(folder)) {
    const resolved = resolveInsideRoots(folder);
    return [{ label: path.basename(resolved), path: resolved }];
  }

  // A subfolder named on its own, e.g. "invoices" — find it under a root.
  const partial = all.filter((root) => root.label.toLowerCase().includes(wanted));
  if (partial.length > 0) return partial;

  throw new Error(
    `I don't have a folder called "${folder}", sir. I can search: ${all.map((r) => r.label).join(", ")}.`
  );
}

export async function searchFiles(options: SearchOptions): Promise<SearchOutcome> {
  const roots = rootsFor(options.folder);
  if (roots.length === 0) {
    throw new Error("There are no folders for me to search, sir — add one in Settings → Files.");
  }

  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 12) || 12, 40));
  const deadline = Date.now() + TIME_BUDGET_MS;
  const scored: { match: FileMatch; score: number; modifiedMs: number }[] = [];

  let scanned = 0;
  let truncated = false;

  // Breadth-first, so that when the budget runs out what's been seen is the
  // shallow, likely part of the tree rather than one deep corner of it.
  const queue: { dir: string; depth: number }[] = roots.map((root) => ({ dir: root.path, depth: 0 }));

  while (queue.length > 0) {
    if (scanned >= MAX_DIRECTORIES || Date.now() > deadline) {
      truncated = true;
      break;
    }

    const { dir, depth } = queue.shift()!;
    scanned++;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Permission denied, or it vanished between listing and reading. Neither
      // is worth failing the whole search over.
      continue;
    }

    for (const entry of entries) {
      // Symlinks are skipped outright rather than resolved: following one is
      // the one way a walk that started inside a root ends up outside it.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !shouldSkipDirectory(entry.name)) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.startsWith(".")) continue;
      if (!matchesKind(entry.name, options.kind)) continue;

      const score = matchScore(entry.name, options.query);
      if (score === null) continue;

      const full = path.join(dir, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(full);
      } catch {
        continue;
      }

      scored.push({
        score,
        modifiedMs: stats.mtimeMs,
        match: {
          name: entry.name,
          path: full,
          folder: dir,
          kind: kindOf(entry.name),
          size: formatBytes(stats.size),
          modified: new Date(stats.mtimeMs).toISOString(),
        },
      });
    }
  }

  // Best match first; among equally good names, the one touched most recently
  // is almost always the one meant.
  scored.sort((a, b) => b.score - a.score || b.modifiedMs - a.modifiedMs);

  return {
    matches: scored.slice(0, limit).map((entry) => entry.match),
    searched: roots.map((root) => root.label),
    scanned,
    truncated: truncated && scored.length <= limit,
  };
}

export interface OpenedFile {
  path: string;
  name: string;
  isDirectory: boolean;
  note: string;
}

/**
 * Open something that was found. The path goes through resolveInsideRoots
 * first, so a path the model invented — or one lifted out of a document it
 * read — cannot be opened just because it was well formed.
 */
export async function openFile(candidate: string): Promise<OpenedFile> {
  const resolved = resolveInsideRoots(candidate);
  const isDirectory = fs.statSync(resolved).isDirectory();
  await openLocalPath(resolved);
  const name = path.basename(resolved);
  return {
    path: resolved,
    name,
    isDirectory,
    note: `Opened ${isDirectory ? "folder" : ""} ${name}`.replace(/\s+/g, " ").trim(),
  };
}
