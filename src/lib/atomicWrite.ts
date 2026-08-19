import fs from "node:fs";
import path from "node:path";

// Writing a file that something else may be reading at the same moment.
//
// Two problems, both of which bite on Windows in particular. A plain
// writeFileSync truncates the file first, so a reader arriving mid-write sees
// half a file — and half a JSON settings file or half a session log is worse
// than none, because it persists. And Windows refuses to open a file that
// another handle has open, so two requests saving at once produce EPERM or
// EBUSY rather than one simply winning.
//
// Writing to a temporary file and renaming it over the target fixes the first:
// rename is atomic, so a reader sees either the old file or the new one, never
// a partial. A short retry fixes the second, since the conflicting handle is
// almost always gone within a few milliseconds.

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES", "EEXIST"]);
const ATTEMPTS = 4;

/** Block briefly without yielding — these are synchronous file APIs. */
function pause(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Deliberately spinning: a few milliseconds, a handful of times, only on a
    // contended write. Anything async here would change every caller.
  }
}

export function writeFileAtomic(file: string, contents: string, mode = 0o600): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });

  // Same directory as the target, so the rename stays on one filesystem.
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      fs.writeFileSync(temporary, contents, { mode });
      fs.renameSync(temporary, file);
      return;
    } catch (err) {
      lastError = err;
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // The temp file will be cleaned up by the next successful write.
      }
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRYABLE.has(code)) break;
      pause(8 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
