import fs from "node:fs";
import path from "node:path";
import { getSetting } from "./settings";
import { writeFileAtomic } from "./atomicWrite";
import { searchRoots, isFileSearchEnabled } from "./files";
import { isGmailConfigured, searchEmails, isCalendarConfigured } from "./gmail";
import { listEvents } from "./calendar";
import { channelStats, configuredChannel, isYouTubeConfigured } from "./youtube";
import { standings, trackedRivals } from "./competitors";
import { daysLate, formatMoney, isoDay, position, totalsOf } from "./bills";

// Axis speaking first.
//
// He has only ever answered. This is the other half: noticing something and
// mentioning it, the way anyone who works for you would.
//
// The whole design rests on one rule, because without it this feature is
// worthless and irritating in equal measure:
//
//   HE MAY ONLY MENTION THINGS THIS FILE HAS ACTUALLY FOUND.
//
// Nothing here generates a topic. It gathers facts — real unread counts, real
// subscriber numbers, real files with real timestamps — and if it finds none,
// the answer is silence. There is no fallback that reaches for a fact about
// seals. A model is asked to phrase what was found, never to think of
// something to say.
//
// The second rule is about not being a nuisance: nothing is said twice, and
// nothing is said sooner than the interval allows.

export type NoticeKind = "email" | "channel" | "work" | "calendar" | "money" | "quiet";

export interface Notice {
  kind: NoticeKind;
  /**
   * Identity of this exact fact. Two gatherings that find the same thing
   * produce the same key, which is what stops him mentioning it twice.
   */
  key: string;
  /** The fact, stated plainly. This, and nothing else, is what he may say. */
  fact: string;
}

const STATE_PATH = path.join(process.cwd(), "data", "notices.json");

interface State {
  /** key -> when it was said, so a fact is never repeated. */
  said: Record<string, number>;
  /** When he last said anything at all. */
  lastSpokeAt: number;
  /** Numbers from last time, to notice what moved. */
  seen: { subscribers?: number; views?: number; unread?: number };
}

const EMPTY: State = { said: {}, lastSpokeAt: 0, seen: {} };

function readState(): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) as State;
    return {
      said: parsed.said ?? {},
      lastSpokeAt: parsed.lastSpokeAt ?? 0,
      seen: parsed.seen ?? {},
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeState(state: State): void {
  try {
    // A fact said more than a fortnight ago may as well be new again, and this
    // keeps the file from growing for ever.
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const said = Object.fromEntries(
      Object.entries(state.said).filter(([, when]) => when > cutoff)
    );
    writeFileAtomic(STATE_PATH, JSON.stringify({ ...state, said }, null, 2));
  } catch {
    // Losing the record means he might repeat himself once. Not worth an error.
  }
}

export function isNoticingEnabled(): boolean {
  return (getSetting("IDLE_TALK") ?? "off").toLowerCase() === "on";
}

/** How long between remarks. Deliberately generous; he is not a notification. */
export function noticeInterval(): number {
  const configured = Number(getSetting("IDLE_TALK_MINUTES"));
  const minutes = Number.isFinite(configured) && configured >= 2 ? configured : 20;
  return minutes * 60 * 1000;
}

/** Whether enough time has passed to say anything at all. */
export function isDue(now = Date.now()): boolean {
  if (!isNoticingEnabled()) return false;
  return now - readState().lastSpokeAt >= noticeInterval();
}

// --- the signals -----------------------------------------------------------

/** Unread mail: how much, and who from. */
async function emailNotices(state: State): Promise<Notice[]> {
  if (!isGmailConfigured()) return [];

  const unread = await searchEmails("is:unread", 5);
  const count = unread.length;
  state.seen.unread = count;
  if (count === 0) return [];

  const newest = unread[0];
  const from = unread
    .slice(0, 3)
    .map((mail) => mail.from.replace(/\s*<[^>]*>/, "").trim())
    .filter(Boolean);

  return [
    {
      kind: "email",
      // Keyed on the newest message, so the same inbox state is one remark.
      key: `email:${newest.id}:${count}`,
      fact:
        `${count} unread email${count === 1 ? "" : "s"}. ` +
        `The most recent is from ${from[0] || "someone"}, subject "${newest.subject}".` +
        (from.length > 1 ? ` Also waiting: ${from.slice(1).join(", ")}.` : ""),
    },
  ];
}

/** His channel, but only when a number has actually moved. */
async function channelNotices(state: State): Promise<Notice[]> {
  if (!isYouTubeConfigured() || !configuredChannel()) return [];

  const stats = await channelStats();
  const previousSubs = state.seen.subscribers;
  const previousViews = state.seen.views;
  // A channel may hide its subscriber count, and then there is no number here
  // to compare against — views still move, so that half still works.
  const subscribers = stats.subscribers ?? undefined;
  state.seen.subscribers = subscribers;
  state.seen.views = stats.views;

  // Nothing to report the first time: there is no "before" to compare against,
  // and "you have 1,200 subscribers" is not news, it is a number he knows.
  if (previousViews === undefined) return [];

  const subs =
    subscribers !== undefined && previousSubs !== undefined ? subscribers - previousSubs : 0;
  const views = stats.views - previousViews;
  if (subs === 0 && views === 0) return [];

  const bits: string[] = [];
  if (subs !== 0 && subscribers !== undefined) {
    bits.push(
      `${subs > 0 ? "up" : "down"} ${Math.abs(subs).toLocaleString()} subscriber${
        Math.abs(subs) === 1 ? "" : "s"
      } to ${subscribers.toLocaleString()}`
    );
  }
  if (views > 0) bits.push(`${views.toLocaleString()} more views`);
  if (bits.length === 0) return [];

  return [
    {
      kind: "channel",
      key: `channel:${subscribers ?? "hidden"}:${stats.views}`,
      fact: `His channel "${stats.title}" is ${bits.join(", ")} since he was last told.`,
    },
  ];
}

/**
 * Money that is late.
 *
 * The one thing on this list he would actually want interrupting for. An
 * invoice nobody has paid does not chase itself, and a bill he has forgotten
 * costs him a fee — so both directions are looked at, and the oldest is the one
 * mentioned, because that is the one that has been ignored longest.
 *
 * The key carries the day, so it can be raised again tomorrow if it is still
 * outstanding, but never twice in the same day.
 */
function billNotices(): Notice[] {
  const today = isoDay(new Date());
  const now = position(today);
  const late = [...now.overdueOut, ...now.overdueIn];
  if (late.length === 0) return [];

  const worst = late.reduce((oldest, bill) => (bill.due < oldest.due ? bill : oldest), late[0]);
  const days = daysLate(worst, today);
  const { totalMinor } = totalsOf(worst.lines, worst.taxPercent);
  const money = formatMoney(totalMinor, worst.currency);

  const others =
    late.length > 1
      ? ` ${late.length - 1} other${late.length === 2 ? " is" : "s are"} overdue as well.`
      : "";

  return [
    {
      kind: "money",
      key: `bill:${worst.number}:${today}`,
      fact:
        worst.direction === "outgoing"
          ? `Invoice ${worst.number} to ${worst.party} for ${money} is ${days} day${days === 1 ? "" : "s"} overdue.${others}`
          : `A bill from ${worst.party} for ${money} was due ${worst.due}, ${days} day${days === 1 ? "" : "s"} ago.${others}`,
    },
  ];
}

/**
 * A competitor who has moved.
 *
 * Looked at without recording, so asking him for the full report afterwards
 * still shows the change rather than a row of zeroes.
 */
async function rivalNotices(): Promise<Notice[]> {
  if (!isYouTubeConfigured() || trackedRivals().length === 0) return [];

  const report = await standings(false);
  const moved = report.rivals
    .filter((rival) => rival.subscriberChange !== null && Math.abs(rival.subscriberChange) > 0)
    .sort((a, b) => Math.abs(b.subscriberChange ?? 0) - Math.abs(a.subscriberChange ?? 0));
  if (moved.length === 0) return [];

  const biggest = moved[0];
  const change = biggest.subscriberChange as number;
  const mine =
    report.mine && report.mine.subscriberChange !== null
      ? ` His own channel is ${report.mine.subscriberChange >= 0 ? "up" : "down"} ${Math.abs(
          report.mine.subscriberChange
        ).toLocaleString()} over the same stretch.`
      : "";

  return [
    {
      kind: "channel",
      key: `rival:${biggest.title}:${biggest.subscribers}`,
      fact:
        `${biggest.title}, a channel he follows, is ${change >= 0 ? "up" : "down"} ` +
        `${Math.abs(change).toLocaleString()} subscribers since he was last told, at ` +
        `${biggest.subscribers?.toLocaleString() ?? "an undisclosed number"}.${mine}`,
    },
  ];
}

/** The documents he has actually been working on. */
const DOCUMENT_KINDS = new Set([
  ".doc", ".docx", ".odt", ".pages", ".rtf",
  ".ppt", ".pptx", ".key", ".odp",
  ".xls", ".xlsx", ".numbers", ".csv", ".ods",
  ".pdf", ".md", ".txt", ".tex",
]);

/** Folders that are full of churn nobody is "working on". */
const SKIP = /^(node_modules|\.git|\.next|Library|AppData|venv|__pycache__|dist|build)$/i;

interface RecentFile {
  name: string;
  modifiedAt: number;
  folder: string;
}

/**
 * Documents touched in the last day, newest first.
 *
 * Walks the same folders the search tool is allowed into — one allowlist, in
 * files.ts, rather than a second one here that could drift from it. Depth and
 * count are capped so this stays a glance rather than a scan.
 */
export function recentDocuments(since: number, limit = 5): RecentFile[] {
  if (!isFileSearchEnabled()) return [];

  const found: RecentFile[] = [];
  let budget = 4000;

  const walk = (dir: string, label: string, depth: number) => {
    if (depth > 3 || budget <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (budget-- <= 0) return;
      if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.test(entry.name)) continue;
        walk(full, label, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!DOCUMENT_KINDS.has(path.extname(entry.name).toLowerCase())) continue;

      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= since) {
          found.push({ name: entry.name, modifiedAt: stat.mtimeMs, folder: label });
        }
      } catch {
        // A file that vanished between listing and reading is not a problem.
      }
    }
  };

  for (const root of searchRoots()) walk(root.path, root.label, 0);

  return found.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}

function workNotices(): Notice[] {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = recentDocuments(since);
  if (recent.length === 0) return [];

  const newest = recent[0];
  const hours = Math.max(1, Math.round((Date.now() - newest.modifiedAt) / (60 * 60 * 1000)));
  const others = recent.slice(1, 3).map((file) => file.name);

  return [
    {
      kind: "work",
      key: `work:${newest.name}:${Math.round(newest.modifiedAt / 60000)}`,
      fact:
        `He was last working on "${newest.name}" in ${newest.folder}, about ${hours} hour${
          hours === 1 ? "" : "s"
        } ago.` + (others.length ? ` Also touched today: ${others.join(", ")}.` : ""),
    },
  ];
}

/** Anything in the diary in the next few hours. */
async function calendarNotices(): Promise<Notice[]> {
  if (!isCalendarConfigured()) return [];

  const events = await listEvents({ max: 3 });
  const soon = events.filter((event) => {
    const start = new Date(event.start).getTime();
    return Number.isFinite(start) && start > Date.now() && start - Date.now() < 4 * 60 * 60 * 1000;
  });
  if (soon.length === 0) return [];

  const next = soon[0];
  const minutes = Math.round((new Date(next.start).getTime() - Date.now()) / 60000);
  return [
    {
      kind: "calendar",
      key: `calendar:${next.id}`,
      fact: `"${next.summary}" starts in about ${minutes} minutes.`,
    },
  ];
}

// --- putting it together ---------------------------------------------------

export interface Gathered {
  notices: Notice[];
  /** True when everything was checked and there was genuinely nothing. */
  allQuiet: boolean;
}

/**
 * Everything worth mentioning that he has not already been told.
 *
 * Each source is allowed to fail on its own. A Gmail token that expired should
 * cost him the email line, not the whole remark.
 */
export async function gatherNotices(): Promise<Gathered> {
  const state = readState();

  const results = await Promise.allSettled([
    emailNotices(state),
    channelNotices(state),
    rivalNotices(),
    Promise.resolve(workNotices()),
    Promise.resolve(billNotices()),
    calendarNotices(),
  ]);

  const all: Notice[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") all.push(...result.value);
  }

  writeState(state);

  const fresh = all.filter((notice) => !state.said[notice.key]);
  return { notices: fresh, allQuiet: all.length === 0 };
}

/** Remember what he was told, and when. */
export function markSaid(keys: string[], now = Date.now()): void {
  const state = readState();
  for (const key of keys) state.said[key] = now;
  state.lastSpokeAt = now;
  writeState(state);
}

/**
 * How long since anything at all was worth saying.
 *
 * Used for the one line he is allowed to volunteer with no news in it — "no new
 * email, nothing on the channel" — which he only earns after a long quiet
 * stretch. Said every twenty minutes it would be nagging; said once in a
 * morning it is reassurance.
 */
export function quietFor(now = Date.now()): number {
  return now - readState().lastSpokeAt;
}

// --- what he is allowed to say ---------------------------------------------

/**
 * The rules he phrases a remark under.
 *
 * Kept here rather than in the route because it is the feature, not plumbing:
 * everything that stops this from becoming a trivia generator is in these
 * lines, and they belong beside the code that gathers the facts they refer to.
 */
export const NOTICE_SYSTEM = `You are Axis, a private assistant, speaking to your principal without being asked.

You are given one or more FACTS that have just been gathered from his own accounts and files.
Write ONE remark, at most two short sentences, mentioning what is worth mentioning.

Absolute rules:
- Use ONLY the facts given. You may not add, embellish, estimate or infer anything.
- If a fact says three unread emails, you may not guess what they are about beyond what is written.
- NEVER volunteer general knowledge, trivia, encouragement, or an observation about the world.
  He is not interested in facts about animals, space or history. He is interested in his own work,
  his own inbox, his own channel, and money he is owed or owes. If the facts do not support a
  remark, write exactly: SKIP
- Money that is late outranks everything else on the list. If a fact says an invoice or a bill is
  overdue, lead with it and say how many days — that is the one thing here worth interrupting for.
- Do not ask him a question he has to answer. You are remarking, not starting an interview.
  A short offer at the end is fine ("I can read it out if you like") but never a demand.
- Do not greet him, do not say "just to let you know", do not apologise for interrupting.
- Be brief. He is working. One breath, not a paragraph.`;

/** Long enough that "all quiet" is reassurance rather than nagging. */
const QUIET_REPORT_AFTER = 3 * 60 * 60 * 1000;

export type Decision =
  | { status: "off" | "too-soon" | "nothing" }
  | { status: "speak"; notices: Notice[] };

/**
 * Whether there is anything to say, and what it may be built from.
 *
 * The interval is decided here rather than in the browser, so a page open in
 * three tabs does not gather three times and a refresh does not reset his
 * patience.
 */
export async function decideNotice(now = Date.now()): Promise<Decision> {
  if (!isNoticingEnabled()) return { status: "off" };
  if (!isDue(now)) return { status: "too-soon" };

  let gathered: Gathered;
  try {
    gathered = await gatherNotices();
  } catch {
    return { status: "nothing" };
  }

  if (gathered.notices.length > 0) {
    // Two at most: three things at once stops being a remark and becomes a
    // report, and he is meant to be glancing up from his work, not delivering.
    return { status: "speak", notices: gathered.notices.slice(0, 2) };
  }

  // The one thing he may say with no news in it, and only after a long silence.
  // Every twenty minutes it would be nagging; once in a morning it is
  // reassurance that he is still watching.
  if (gathered.allQuiet && quietFor(now) >= QUIET_REPORT_AFTER) {
    return {
      status: "speak",
      notices: [
        {
          kind: "quiet",
          key: `quiet:${new Date(now).toISOString().slice(0, 13)}`,
          fact: "Nothing new: no unread email, nothing moving on the channel, no files touched today.",
        },
      ],
    };
  }

  return { status: "nothing" };
}

/** The facts, as they are handed to the model. */
export function noticePrompt(notices: Notice[], title: string): string {
  const facts = notices.map((notice) => `- ${notice.fact}`).join("\n");
  return `He is called "${title}".\n\nFACTS:\n${facts}\n\nWrite the remark, or SKIP.`;
}
