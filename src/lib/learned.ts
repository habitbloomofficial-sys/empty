import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { MEMORY_DIR } from "./memory";

// The fourth memory layer: what Axis has learned.
//
//   MEMORY.md   facts about you        — your sister's name, how you take coffee
//   USER.md     who you are            — standing preferences
//   NOTES.md    lessons                — what went wrong once already
//   LEARNED.md  what he has picked up  — this file
//
// It is separate from MEMORY.md deliberately. That file is small on purpose,
// read into every prompt, and it is about *you*; the day a fact about lithium
// prices lands in it, it stops being a description of your life. This one is
// about the world — things looked up, worked out, or corrected — with the
// source kept beside each line so a claim can be traced back rather than
// believed because he said it.
//
// It is a plain Markdown list. Open it, correct a line, save: he reads the
// file, not a cache.

const LEARNED_PATH = path.join(MEMORY_DIR, "LEARNED.md");

/** Beyond this the oldest are dropped — it is knowledge, not an archive. */
const MAX_ENTRIES = 300;
/** How much of the prompt this layer may occupy. */
const PROMPT_BUDGET = 900;

const HEADER = `# What Axis has learned

> Things he has looked up, been told, or worked out — about the world, and
> about how to do this job well. One per line, with where it came from. Edit or
> delete any of them; he reads this file as it is.

`;

export interface Learned {
  text: string;
  source?: string;
  date?: string;
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function read(): string {
  try {
    return fs.readFileSync(LEARNED_PATH, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Parse the list back out.
 *
 * A line looks like: `- 2026-08-22 — Denmark's VAT is 25%. (skat.dk)`
 * All three trimmings are optional, because this file is meant to be edited by
 * hand and a hand-written line will not have them.
 */
export function parseLearned(markdown: string): Learned[] {
  const entries: Learned[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    // Blockquotes are guidance to the reader, not something he learned.
    if (line.startsWith(">")) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!bullet) continue;

    let rest = bullet[1].trim();
    if (!rest) continue;

    let date: string | undefined;
    const dated = /^(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.*)$/.exec(rest);
    if (dated) {
      date = dated[1];
      rest = dated[2].trim();
    }

    let source: string | undefined;
    const sourced = /^(.*?)\s*\(([^()]{2,120})\)$/.exec(rest);
    if (sourced) {
      rest = sourced[1].trim();
      source = sourced[2].trim();
    }

    if (rest) entries.push({ text: rest, source, date });
  }
  return entries;
}

function render(entries: Learned[]): string {
  const lines = entries.map((entry) => {
    const stamp = entry.date ? `${entry.date} — ` : "";
    const source = entry.source ? ` (${entry.source})` : "";
    return `- ${stamp}${entry.text}${source}`;
  });
  return `${HEADER}${lines.join("\n")}\n`;
}

// Words too common to identify anything. Without this, "forget the one about
// the tax" scores a match on "the" and deletes whichever line happens to
// contain it — which is how you lose a fact you never mentioned.
const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "was", "were", "are", "his",
  "her", "him", "she", "they", "them", "you", "your", "about", "from", "one",
  "what", "when", "where", "which", "how", "has", "have", "had", "not", "but",
  "its", "our", "their", "there", "then", "than", "into", "out", "over",
]);

/** Words from a query that are worth matching on. */
function keywords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** For comparing two statements of the same thing. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function listLearned(): Learned[] {
  return parseLearned(read());
}

export function learnedCount(): number {
  return listLearned().length;
}

export interface LearnResult {
  entry: Learned;
  /** True when this replaced or refreshed something already on the list. */
  wasAlreadyKnown: boolean;
}

/**
 * Write down something learned.
 *
 * Re-learning the same thing moves it to the top rather than adding a second
 * copy — and takes the newer source with it, since a fact re-checked today has
 * a better provenance than the same fact from a month ago.
 */
export function learn(rawText: string, source?: string, now: Date = new Date()): LearnResult {
  const text = rawText.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("There's nothing there to learn, sir.");
  if (text.length > 500) {
    throw new Error("That's too long to keep as one thing learned, sir — give me the short of it.");
  }

  // Parentheses would be read back as the source, so the source field is the
  // only place they may end a line.
  const clean = source?.trim().replace(/[()]/g, "").slice(0, 120) || undefined;

  const entries = listLearned();
  const key = normalise(text);
  const at = entries.findIndex((entry) => normalise(entry.text) === key);

  let entry: Learned;
  let wasAlreadyKnown = false;
  if (at !== -1) {
    const [existing] = entries.splice(at, 1);
    entry = { text, source: clean ?? existing.source, date: today(now) };
    wasAlreadyKnown = true;
  } else {
    entry = { text, source: clean, date: today(now) };
  }

  entries.unshift(entry);
  writeFileAtomic(LEARNED_PATH, render(entries.slice(0, MAX_ENTRIES)));
  return { entry, wasAlreadyKnown };
}

/** Drop whichever entry best matches the words given. */
export function unlearn(query: string): Learned | null {
  const entries = listLearned();
  const needle = normalise(query);
  if (!needle) return null;

  const words = new Set(keywords(query));
  if (words.size === 0) return null;
  let best = -1;
  let bestScore = 0;
  entries.forEach((entry, index) => {
    const entryWords = new Set(normalise(entry.text).split(" "));
    let score = 0;
    for (const word of words) if (entryWords.has(word)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });

  // One word in common is a coincidence, not a match.
  if (best === -1 || (bestScore < 2 && !(bestScore === 1 && words.size === 1))) return null;

  const [removed] = entries.splice(best, 1);
  writeFileAtomic(LEARNED_PATH, render(entries));
  return removed;
}

/** Search what he's learned, for when the answer is already on the list. */
export function searchLearned(query: string, limit = 12): Learned[] {
  const entries = listLearned();
  const needle = normalise(query);
  if (!needle) return entries.slice(0, limit);

  const words = keywords(query);
  if (words.length === 0) return entries.slice(0, limit);

  return entries
    .map((entry) => {
      const haystack = normalise(`${entry.text} ${entry.source ?? ""}`);
      let score = 0;
      for (const word of words) if (haystack.includes(word)) score++;
      return { entry, score };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

/**
 * The layer as it goes into the system prompt. Newest first, trimmed to a
 * budget — the same discipline as the other three layers, for the same reason.
 */
export function learnedForPrompt(budget = PROMPT_BUDGET): string {
  const entries = listLearned();
  if (entries.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const line = `- ${entry.text}${entry.source ? ` (${entry.source})` : ""}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
