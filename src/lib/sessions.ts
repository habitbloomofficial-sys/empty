import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { MEMORY_DIR } from "./memory";
import {
  clockTime,
  detectStartCase,
  parseSession,
  recentRecap,
  renderSession,
  sessionKey,
  summariseSession,
  type SessionLog,
  type SessionStatus,
  type StartCase,
} from "./sessionFormat";

// The part of memory that answers "where were we?".
//
// Facts say what Axis knows; a session says what happened. One Markdown file
// per day, each line stamped with the time, and a status marker saying how the
// day ended — paused, closed, or nothing at all, which means it stopped
// without warning. That last case is the one worth designing for: a browser
// crash, a laptop lid, a power cut. Reading back a timestamped list makes
// picking up again trivial, for him and for you.

/** Lines the log keeps for its own sake rather than for what they say. */
const BOOKKEEPING = /^session (opened|resumed|recovered)/i;
const OPENING_LINE = BOOKKEEPING;

const SESSIONS_DIR = path.join(MEMORY_DIR, "sessions");
const USER_PATH = path.join(MEMORY_DIR, "USER.md");
const NOTES_PATH = path.join(MEMORY_DIR, "NOTES.md");

/** Prompt budgets, per layer. Small on purpose — see the README. */
const USER_BUDGET = 900;
const NOTES_BUDGET = 700;
const TODAY_BUDGET = 900;
const PREVIOUS_BUDGET = 300;

// Guidance to the reader is written as a blockquote, and blockquotes are
// stripped before this reaches the prompt — so the instructions in the file
// never get read back to Axis as though they were something he knows.
const USER_TEMPLATE = `# About me

> Read at the start of every conversation. Keep it short — who you are, how you
> like things done, what he should never have to ask you twice.

- 
`;

const NOTES_TEMPLATE = `# Notes and lessons

> Things that went wrong once already, and how they were settled. He adds to
> this himself; you can too.

`;

function readFileOr(file: string, fallback: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return fallback;
  }
}

/** Trim a layer to its budget on a line boundary, so it never ends mid-word. */
function budgeted(text: string, budget: number): string {
  const meaningful = text
    .split(/\r?\n/)
    // Headings and blockquoted guidance are for whoever opens the file, not
    // for the prompt — carrying them would have Axis reading his own
    // instructions back as facts about you.
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith(">");
    })
    .join("\n")
    .trim();
  if (meaningful.length <= budget) return meaningful;

  const kept: string[] = [];
  let used = 0;
  for (const line of meaningful.split("\n")) {
    if (used + line.length > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}

export function readUserProfile(): string {
  return readFileOr(USER_PATH, "");
}

export function readNotes(): string {
  return readFileOr(NOTES_PATH, "");
}

export function writeUserProfile(text: string): void {
  writeFileAtomic(USER_PATH, text);
}

export function writeNotes(text: string): void {
  writeFileAtomic(NOTES_PATH, text);
}

/** Append one lesson to NOTES.md, dated. */
export function noteLesson(text: string, now: Date = new Date()): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("There's nothing there to note, sir.");
  const existing = readNotes() || NOTES_TEMPLATE;
  const line = `- ${sessionKey(now)} — ${clean}`;
  writeNotes(`${existing.trimEnd()}\n${line}\n`);
  return clean;
}

function sessionFile(date: string): string {
  return path.join(SESSIONS_DIR, `${date}.md`);
}

export function readSession(date: string): SessionLog | null {
  try {
    return parseSession(fs.readFileSync(sessionFile(date), "utf-8"), date);
  } catch {
    return null;
  }
}

function writeSession(session: SessionLog): void {
  writeFileAtomic(sessionFile(session.date), renderSession(session));
}

/** Session dates on disk, newest first. */
export function listSessionDates(): string[] {
  try {
    return fs
      .readdirSync(SESSIONS_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .map((name) => name.replace(/\.md$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** The most recent session before `date` that has anything in it. */
export function previousSession(date: string): SessionLog | null {
  for (const candidate of listSessionDates()) {
    if (candidate >= date) continue;
    const session = readSession(candidate);
    if (session && session.recap.length > 0) return session;
  }
  return null;
}

/**
 * Add a line to today's RECAP. Every action Axis takes goes through here, so
 * that a session read back later is a record of what actually happened rather
 * than of what was meant to.
 */
export function logRecap(text: string, now: Date = new Date()): void {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!clean) return;

  const date = sessionKey(now);
  const session = readSession(date) ?? {
    date,
    status: "open" as SessionStatus,
    opened: clockTime(now),
    recap: [],
  };

  const last = session.recap[session.recap.length - 1];
  // Asking the same thing twice in a minute is one event, not two.
  if (last && last.text === clean) return;

  session.recap.push({ time: clockTime(now), text: clean });
  // Writing a line means the session is live again, whatever it was before.
  session.status = "open";
  writeSession(session);
}

/** Mark how the session ended, which is what makes resuming meaningful. */
export function markSession(status: SessionStatus, now: Date = new Date()): SessionLog | null {
  const date = sessionKey(now);
  const session = readSession(date);
  if (!session) return null;
  session.status = status;
  writeSession(session);
  return session;
}

export interface SessionBriefing {
  case: StartCase;
  date: string;
  /** One or two sentences, in Axis's voice, for him to say out loud. */
  briefing: string;
  today: SessionLog;
  previous: { date: string; summary: string } | null;
}

/**
 * Open a session — the equivalent of the `/start` ritual. Three cases, exactly
 * as in the design this follows: a fresh day, a session being picked up, and
 * one that stopped without saying so.
 */
export function startSession(now: Date = new Date(), device?: string): SessionBriefing {
  const date = sessionKey(now);
  const existing = readSession(date);
  const startCase = detectStartCase(existing, now);
  const previous = previousSession(date);

  const session: SessionLog = existing ?? {
    date,
    status: "open",
    opened: clockTime(now),
    recap: [],
  };

  const where = device ? ` on ${device}` : "";
  const openingLine =
    startCase === "new-day"
      ? `Session opened (new day)${where}`
      : startCase === "resume"
        ? `Session resumed${where}`
        : `Session recovered after an interruption ⚠${where}`;

  // Reopening within the same minute is one arrival — a refresh, or React
  // remounting the page in development. Recording it twice would make the log
  // read as though something happened when nothing did.
  const last = session.recap[session.recap.length - 1];
  const sameMinute = last?.time === clockTime(now);
  if (!(sameMinute && (last.text === openingLine || OPENING_LINE.test(last.text)))) {
    session.recap.push({ time: clockTime(now), text: openingLine });
  }
  session.status = "open";
  writeSession(session);

  return {
    case: startCase,
    date,
    briefing: buildBriefing(startCase, session, previous),
    today: session,
    previous: previous ? { date: previous.date, summary: summariseSession(previous) } : null,
  };
}

function buildBriefing(
  startCase: StartCase,
  today: SessionLog,
  previous: SessionLog | null
): string {
  if (startCase === "new-day") {
    if (!previous) return "";
    // Named by how long ago rather than by date: "yesterday" is how anyone
    // actually refers to it, and a bare date makes him sound like a filing
    // cabinet.
    return `When we last spoke, ${whenWas(previous.date, today.date)}, ${summariseSession(previous, 260)}.`;
  }

  // Both resuming and recovering want the same thing: the last few things that
  // happened. The difference is only whether we know the session ended tidily.
  const recent = recentRecap(today, 4).filter(
    (entry) => !/^session (opened|resumed|recovered)/i.test(entry.text)
  );
  if (recent.length === 0) {
    return startCase === "recovery"
      ? "We were interrupted, sir, though nothing had been recorded yet."
      : "";
  }

  const items = recent.map((entry) => `${entry.time}, ${entry.text}`).join("; ");
  return startCase === "recovery"
    ? `We were interrupted, sir. Before that: ${items}.`
    : `Picking up where we left off — ${items}.`;
}

/** "yesterday", "on Tuesday", "on the 3rd of March" — whichever fits. */
export function whenWas(date: string, relativeTo: string): string {
  const then = new Date(`${date}T12:00:00`);
  const now = new Date(`${relativeTo}T12:00:00`);
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);

  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) {
    return `on ${then.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  if (days < 14) return "last week";
  return `on ${then.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

export interface RecallHit {
  date: string;
  time: string;
  text: string;
}

/**
 * Search the session history. This is what makes the log worth keeping: "what
 * did we do on Tuesday" is answerable from a file rather than from a model's
 * imagination.
 */
export function searchSessions(query: string, limit = 12): RecallHit[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 2);

  const hits: RecallHit[] = [];
  for (const date of listSessionDates()) {
    const session = readSession(date);
    if (!session) continue;
    for (const entry of session.recap) {
      const haystack = entry.text.toLowerCase();
      // An empty query means "the recent history", which is a fair reading of
      // "what have we been doing".
      const matched = words.length === 0 || words.every((word) => haystack.includes(word));
      if (matched) hits.push({ date, time: entry.time, text: entry.text });
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

/** Everything the layers contribute to the system prompt, already budgeted. */
export function memoryContextForPrompt(now: Date = new Date()): string {
  const sections: string[] = [];

  const user = budgeted(readUserProfile(), USER_BUDGET);
  if (user) sections.push(`About him:\n${user}`);

  const notes = budgeted(readNotes(), NOTES_BUDGET);
  if (notes) sections.push(`Lessons already learned — don't repeat these:\n${notes}`);

  const date = sessionKey(now);
  const today = readSession(date);
  if (today) {
    // "Session opened" tells the model nothing; it exists so that a human
    // reading the file — and the crash detection — can see the shape of a day.
    const events = today.recap.filter((entry) => !BOOKKEEPING.test(entry.text));
    if (events.length > 0) {
      const lines = events
        .slice(-12)
        .map((entry) => `- ${entry.time} — ${entry.text}`)
        .join("\n");
      sections.push(`Today so far (${date}):\n${budgeted(lines, TODAY_BUDGET)}`);
    }
  }

  const previous = previousSession(date);
  if (previous) {
    sections.push(
      `Last session (${previous.date}): ${summariseSession(previous, PREVIOUS_BUDGET)}`
    );
  }

  return sections.join("\n\n");
}

/** Create the editable layers on first run, so there's something to open. */
export function ensureMemoryFiles(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  if (!fs.existsSync(USER_PATH)) writeUserProfile(USER_TEMPLATE);
  if (!fs.existsSync(NOTES_PATH)) writeNotes(NOTES_TEMPLATE);
}

export { sessionKey };
export type { SessionLog, SessionStatus, StartCase };
