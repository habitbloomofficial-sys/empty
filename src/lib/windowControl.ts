import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isDesktopControlEnabled } from "./desktop";

// Moving windows around on his desk.
//
// This is the part of "control of my computer" that isn't opening things: put
// that window in front, get everything out of the way, put these two side by
// side so I can copy between them.
//
// Two deliberate absences.
//
// Nothing here CLOSES a window. A window with half an email in it is work, and
// a wrong guess about which window he meant destroys it silently — there is no
// undo for a closed window and no way to tell afterwards that it happened.
// Opening and arranging are recoverable in a way that closing is not.
//
// And no window title from a conversation is ever interpolated into the
// PowerShell script. Titles are attacker-shaped text: they come from web page
// headings, email subjects, file names. They travel in an environment variable
// that PowerShell reads as data, so a title containing a quote and a semicolon
// is a title containing a quote and a semicolon, not a second command.

const run = promisify(execFile);

/** The desk arrangements Windows itself knows how to do. */
export const ARRANGEMENTS = ["side-by-side", "stacked", "cascade", "minimise-all", "restore-all"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export function isArrangement(value: string): value is Arrangement {
  return (ARRANGEMENTS as readonly string[]).includes(value);
}

/** Shell.Application's own names for them. */
const SHELL_METHOD: Record<Arrangement, string> = {
  "side-by-side": "TileVertically",
  stacked: "TileHorizontally",
  cascade: "CascadeWindows",
  "minimise-all": "MinimizeAll",
  "restore-all": "UndoMinimizeALL",
};

function requireWindows(): void {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Moving windows about is switched off, sir — enable desktop control in Settings."
    );
  }
  if (process.platform !== "win32") {
    throw new Error("Arranging windows only works on Windows, sir.");
  }
}

async function powershell(script: string, extraEnv: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, ...extraEnv }, timeout: 15_000, windowsHide: true }
  );
  return stdout;
}

export interface OpenWindow {
  title: string;
  app: string;
  pid: number;
}

/** Every window with a title bar, so he can be told what there is to choose from. */
export async function listWindows(): Promise<OpenWindow[]> {
  requireWindows();
  const stdout = await powershell(
    "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | " +
      "Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress"
  );

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const parsed: unknown = JSON.parse(trimmed);
  // ConvertTo-Json emits a bare object rather than an array of one.
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row): row is { Id: number; ProcessName: string; MainWindowTitle: string } =>
      typeof row === "object" && row !== null && "MainWindowTitle" in row
    )
    .map((row) => ({ title: row.MainWindowTitle, app: row.ProcessName, pid: row.Id }));
}

export interface FocusResult {
  focused: boolean;
  window: OpenWindow | null;
  /** The other windows that also matched, when the choice wasn't obvious. */
  alsoMatched: string[];
  note: string;
}

/**
 * Bring the window he means to the front.
 *
 * Matching is done HERE, in TypeScript, over a list PowerShell has already
 * handed back — not by passing a pattern into a script. That keeps the search
 * text out of the shell entirely, and it means an ambiguous match can be
 * reported rather than silently resolved to whichever window happened to be
 * first.
 */
export async function focusWindow(search: string): Promise<FocusResult> {
  requireWindows();
  const wanted = search.trim().toLowerCase();
  if (!wanted) throw new Error("Which window, sir?");

  const windows = await listWindows();
  const matches = windows.filter(
    (win) => win.title.toLowerCase().includes(wanted) || win.app.toLowerCase().includes(wanted)
  );

  if (matches.length === 0) {
    return {
      focused: false,
      window: null,
      alsoMatched: [],
      note: `Nothing open with "${search}" in its name, sir.`,
    };
  }

  // The shortest title is almost always the main window rather than a dialog
  // or a document window that happens to mention the same word.
  const target = [...matches].sort((a, b) => a.title.length - b.title.length)[0];

  // AppActivate takes a process id, so nothing of his text reaches PowerShell.
  await powershell(
    "$id = [int]$env:JARVIS_WINDOW_PID; " +
      "$shell = New-Object -ComObject WScript.Shell; " +
      "$null = $shell.AppActivate($id)",
    { JARVIS_WINDOW_PID: String(target.pid) }
  );

  return {
    focused: true,
    window: target,
    alsoMatched: matches.filter((win) => win !== target).map((win) => win.title),
    note: `Brought ${target.title} to the front.`,
  };
}

export async function arrangeWindows(how: Arrangement): Promise<{ note: string }> {
  requireWindows();
  // The method name is looked up from a fixed table, never taken from input.
  await powershell(`(New-Object -ComObject Shell.Application).${SHELL_METHOD[how]}()`);

  const said: Record<Arrangement, string> = {
    "side-by-side": "Windows side by side.",
    stacked: "Windows stacked.",
    cascade: "Windows cascaded.",
    "minimise-all": "Desk cleared.",
    "restore-all": "Windows back as they were.",
  };
  return { note: said[how] };
}
