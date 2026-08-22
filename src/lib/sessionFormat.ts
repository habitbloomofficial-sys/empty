// The shape of a session log, with no filesystem attached.
//
// Session files are Markdown on purpose: the point of a memory you can trust
// is being able to open it and read it. Everything here is therefore
// round-trippable — parse what's on disk, change one thing, write it back —
// and tolerant of a file that has been edited by hand, because it will be.

/** How a session ended, which is what tells us how to resume it. */
export type SessionStatus =
  /** Deliberately paused mid-session: the browser was closed or refreshed. */
  | "paused"
  /** Signed off for the day. */
  | "closed"
  /** Still open, or stopped without warning — the crash case. */
  | "open";

export const STATUS_MARKERS: Record<SessionStatus, string> = {
  paused: "⏸",
  closed: "🔒",
  open: "",
};

export interface RecapEntry {
  /** Local clock time, as written: "08h37". */
  time: string;
  text: string;
}

export interface SessionLog {
  /** Local date, YYYY-MM-DD — also the file name. */
  date: string;
  status: SessionStatus;
  opened: string;
  recap: RecapEntry[];
}

/** The local date, not UTC: a session belongs to the day you lived it. */
export function sessionKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "08h37" — the notation from the architecture this follows. */
export function clockTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

export function renderSession(session: SessionLog): string {
  const marker = STATUS_MARKERS[session.status];
  const status = `${marker ? `${marker} ` : ""}${session.status}`;
  const lines = [
    `# Session ${session.date}`,
    "",
    `Status: ${status}`,
    `Opened: ${session.opened}`,
    "",
    "## RECAP",
    ...session.recap.map((entry) => `- ${entry.time} — ${entry.text}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * Read a session file back. Anything unrecognised is ignored rather than
 * rejected — a file someone has added their own notes to must still load.
 */
export function parseSession(markdown: string, fallbackDate: string): SessionLog {
  const lines = markdown.split(/\r?\n/);

  let date = fallbackDate;
  let status: SessionStatus = "open";
  let opened = "";
  const recap: RecapEntry[] = [];
  let inRecap = false;

  for (const line of lines) {
    const heading = /^#\s+Session\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (heading) {
      date = heading[1];
      continue;
    }

    const statusLine = /^Status:\s*(.*)$/i.exec(line);
    if (statusLine) {
      const value = statusLine[1].toLowerCase();
      // Either the word or the marker is enough, so a hand-typed "closed"
      // works as well as the emoji.
      if (value.includes("closed") || line.includes(STATUS_MARKERS.closed)) status = "closed";
      else if (value.includes("paused") || line.includes(STATUS_MARKERS.paused)) status = "paused";
      else status = "open";
      continue;
    }

    const openedLine = /^Opened:\s*(.+)$/i.exec(line);
    if (openedLine) {
      opened = openedLine[1].trim();
      continue;
    }

    if (/^##\s+RECAP/i.test(line)) {
      inRecap = true;
      continue;
    }
    if (/^##\s+/.test(line)) {
      inRecap = false;
      continue;
    }

    if (inRecap) {
      // "- 08h37 — text", with any of the dashes people actually type.
      const entry = /^[-*]\s*(\d{1,2}[h:]\d{2})\s*[—–-]?\s*(.*)$/.exec(line.trim());
      if (entry && entry[2].trim()) {
        recap.push({ time: entry[1].replace(":", "h"), text: entry[2].trim() });
      }
    }
  }

  return { date, status, opened, recap };
}

/** What opening Axis means, given what the last session left behind. */
export type StartCase =
  /** No session for today: a fresh day. */
  | "new-day"
  /** Today's session was paused or closed and is being picked up again. */
  | "resume"
  /** Today's session was never marked — it stopped without saying so. */
  | "recovery";

/** Minutes between a RECAP time ("08h37") and now, or null if unreadable. */
export function minutesSince(entryTime: string, now: Date): number | null {
  const parsed = /^(\d{1,2})h(\d{2})$/.exec(entryTime.trim());
  if (!parsed) return null;
  const then = new Date(now);
  then.setHours(Number(parsed[1]), Number(parsed[2]), 0, 0);
  return Math.round((now.getTime() - then.getTime()) / 60_000);
}

/**
 * How long a session has to have been silent before reopening it counts as
 * recovering from an interruption rather than simply coming back.
 *
 * Without this, every page refresh looks like a crash: the session is still
 * marked open because nothing had a chance to mark it otherwise, and Axis
 * announces an interruption that never happened. Silence is the evidence, not
 * the missing marker on its own.
 */
export const RECOVERY_SILENCE_MINUTES = 5;

export function detectStartCase(today: SessionLog | null, now: Date = new Date()): StartCase {
  if (!today) return "new-day";
  if (today.status !== "open") return "resume";

  const last = today.recap[today.recap.length - 1];
  if (!last) return "resume";

  const idle = minutesSince(last.time, now);
  // An unreadable time is treated as recent: claiming an interruption on a
  // guess is worse than missing one.
  if (idle === null) return "resume";
  return idle >= RECOVERY_SILENCE_MINUTES ? "recovery" : "resume";
}

/** The last few RECAP lines, oldest first, for a briefing. */
export function recentRecap(session: SessionLog, limit: number): RecapEntry[] {
  return session.recap.slice(-limit);
}

/**
 * One line saying what a session amounted to. Used for the previous day's
 * summary, where the whole log would be far too much to carry.
 */
export function summariseSession(session: SessionLog, maxChars = 220): string {
  if (session.recap.length === 0) return "nothing recorded";
  // The opening line is always "session opened", which says nothing.
  const meaningful = session.recap.filter(
    (entry) => !/^session (opened|resumed|recovered)/i.test(entry.text)
  );
  const source = meaningful.length > 0 ? meaningful : session.recap;

  let summary = "";
  for (const entry of source.slice(-6)) {
    const next = summary ? `${summary}; ${entry.text}` : entry.text;
    if (next.length > maxChars) break;
    summary = next;
  }
  return summary || source[source.length - 1].text.slice(0, maxChars);
}

/**
 * One RECAP line for a completed turn, or null if the turn isn't worth
 * recording.
 *
 * The log is a record of things that happened, not a transcript — a transcript
 * would be both enormous and useless to read back. So: anything he acted on is
 * always kept, a substantial request that produced no action is kept as a
 * topic, and "thanks" is not an event.
 */
export function recapLine(
  request: string,
  actions: { tool: string; summary: string; ok: boolean }[]
): string | null {
  const asked = request.trim().replace(/\s+/g, " ").slice(0, 120);
  // Reading the history shouldn't add to the history.
  const real = actions.filter((action) => action.tool !== "recall");

  if (real.length > 0) {
    const done = real.filter((action) => action.ok).map((action) => action.summary);
    const failed = real.filter((action) => !action.ok).map((action) => action.summary);
    const parts = [...done, ...failed.map((summary) => `failed: ${summary}`)];
    return asked ? `“${asked}” → ${parts.join("; ")}` : parts.join("; ");
  }

  // A real question is worth a line; an acknowledgement is not.
  return asked.length >= 40 ? `Talked about: ${asked}` : null;
}
