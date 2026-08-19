// The decisions behind a file search, with no filesystem attached: which
// folders are in scope, what counts as a match, and how well. Pure, so the
// rules can be tested exhaustively without a disk full of fixtures.

/** File groups people actually ask for by name. */
export const KINDS: Record<string, readonly string[]> = {
  document: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "pages", "epub"],
  spreadsheet: ["xls", "xlsx", "csv", "ods", "numbers"],
  presentation: ["ppt", "pptx", "odp", "key"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "tif", "tiff", "svg", "raw", "cr2"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v", "mpg"],
  audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma", "aiff"],
  archive: ["zip", "rar", "7z", "tar", "gz", "iso"],
  code: ["js", "ts", "tsx", "jsx", "py", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "html", "css", "json", "yml", "yaml", "sh"],
};

/** Folders never worth walking: system trees and dependency dumps. */
export const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "appdata",
  "application data",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "$recycle.bin",
  "system volume information",
  "library",
  "onedrivetemp",
  "temp",
  "tmp",
  "cache",
  "caches",
  ".git",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
]);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** Which named group a file belongs to, or "other". */
export function kindOf(filename: string): string {
  const extension = extensionOf(filename);
  for (const [kind, extensions] of Object.entries(KINDS)) {
    if (extensions.includes(extension)) return kind;
  }
  return "other";
}

export function matchesKind(filename: string, kind: string | undefined): boolean {
  if (!kind || kind === "any" || kind === "all") return true;
  const wanted = kind.toLowerCase().replace(/s$/, "");
  if (wanted in KINDS) return kindOf(filename) === wanted;
  // Not a group — treat it as a bare extension, so "pdf" and ".pdf" both work.
  return extensionOf(filename) === wanted.replace(/^\./, "");
}

/** A directory worth descending into. */
export function shouldSkipDirectory(name: string): boolean {
  const lower = name.toLowerCase();
  // Dot-directories and Windows' $-prefixed system folders hold nothing a
  // person would ask for by name, and there are a great many of them.
  return lower.startsWith(".") || lower.startsWith("$") || SKIP_DIRECTORIES.has(lower);
}

/**
 * How well a filename answers a query, or null if it doesn't.
 *
 * Every word must appear somewhere in the name — that's the floor, and it
 * keeps "tax return 2024" from dragging in every file with a 2024 in it. Above
 * the floor, the closer the name is to being *exactly* what was asked for, the
 * higher it ranks.
 */
export function matchScore(filename: string, query: string): number | null {
  const name = filename.toLowerCase();
  const stem = name.slice(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length);
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;

  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.every((word) => name.includes(word))) return null;

  if (stem === needle) return 1000;
  if (name === needle) return 1000;
  if (stem.startsWith(needle)) return 600;
  if (name.includes(needle)) return 400;
  // All the words are there, just not adjacent.
  return 200 - Math.min(stem.length, 150);
}

/**
 * Split a configured roots string into paths. Semicolons first because that's
 * what Windows uses in PATH, but commas and newlines are what people type.
 */
export function parseRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;\n,]+/)
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
