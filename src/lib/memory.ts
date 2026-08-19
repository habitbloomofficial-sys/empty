import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// What JARVIS knows about you between sessions.
//
// Everything lives in `data/memory/` as Markdown, in layers, because a memory
// you cannot read is a memory you cannot trust:
//
//   MEMORY.md   what he currently knows — facts, short, one per line
//   USER.md     who you are and how you like things done
//   NOTES.md    lessons learned; things that went wrong once already
//   sessions/   one file per day, a timestamped record of what happened
//
// The first three are yours to edit. Open them in Notepad, change a line, save
// — he reads the file, not a cache, so the next thing he says already knows.
// Facts he adds himself go to the top of MEMORY.md in the same format he'd
// accept from you.
//
// Timestamps live in a sidecar index rather than cluttering the prose. If it
// goes missing nothing breaks: order in the file is the fallback, and the
// index rebuilds itself on the next write.

export const MEMORY_DIR = path.join(process.cwd(), "data", "memory");
const MEMORY_PATH = path.join(MEMORY_DIR, "MEMORY.md");
const INDEX_PATH = path.join(MEMORY_DIR, ".index.json");
/** The pre-layers store, migrated on first read. */
const LEGACY_PATH = path.join(process.cwd(), "data", "memory.json");

/** Beyond this, the oldest unused memories are dropped. */
const MAX_MEMORIES = 200;
/** Roughly how much of the prompt the facts layer may occupy. */
const MAX_PROMPT_CHARS = 1800;

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  /** Bumped whenever the fact is re-stated, so stale ones fall off first. */
  updatedAt: number;
}

const MEMORY_HEADER = `# What JARVIS knows

One fact per line. Edit or delete any of them — he reads this file as it is.
`;

/** A stable id for a fact, derived from the fact itself. */
function idFor(text: string): string {
  return crypto.createHash("sha1").update(normalise(text)).digest("hex").slice(0, 12);
}

/** For comparing two statements of the same fact. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

type Index = Record<string, { createdAt: number; updatedAt: number }>;

function readIndex(): Index {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Index) : {};
  } catch {
    return {};
  }
}

/** Pull the bullet lines out of a Markdown list, ignoring prose and headings. */
export function parseFacts(markdown: string): string[] {
  const facts: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text) facts.push(text);
  }
  return facts;
}

function migrateLegacy(): void {
  if (fs.existsSync(MEMORY_PATH) || !fs.existsSync(LEGACY_PATH)) return;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return;
    const legacy = parsed
      .filter((e): e is Memory => Boolean(e) && typeof (e as Memory).text === "string")
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const index: Index = {};
    for (const memory of legacy) {
      index[idFor(memory.text)] = {
        createdAt: memory.createdAt ?? Date.now(),
        updatedAt: memory.updatedAt ?? Date.now(),
      };
    }
    writeFacts(legacy.map((m) => m.text), index);
    // Left in place rather than deleted: it costs nothing and it's the only
    // copy of what he knew before this change.
    fs.renameSync(LEGACY_PATH, `${LEGACY_PATH}.migrated`);
  } catch {
    // A corrupt legacy file shouldn't stop him starting.
  }
}

function writeFacts(facts: string[], index: Index): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const body = facts.map((fact) => `- ${fact}`).join("\n");
  fs.writeFileSync(MEMORY_PATH, `${MEMORY_HEADER}\n${body}\n`, { mode: 0o600 });

  // Only for facts that still exist, so the index can't grow forever.
  const kept: Index = {};
  for (const fact of facts) {
    const id = idFor(fact);
    kept[id] = index[id] ?? { createdAt: Date.now(), updatedAt: Date.now() };
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(kept, null, 2), { mode: 0o600 });
}

function load(): Memory[] {
  migrateLegacy();
  let markdown: string;
  try {
    markdown = fs.readFileSync(MEMORY_PATH, "utf-8");
  } catch {
    return [];
  }

  const index = readIndex();
  // File order is the source of truth for recency, so a fact moved to the top
  // by hand is treated as the most recent — which is what moving it means.
  const now = Date.now();
  return parseFacts(markdown).map((text, position) => {
    const id = idFor(text);
    const stamps = index[id];
    return {
      id,
      text,
      createdAt: stamps?.createdAt ?? now,
      updatedAt: stamps?.updatedAt ?? now - position,
    };
  });
}

function save(memories: Memory[]): void {
  const index: Index = {};
  for (const memory of memories) {
    index[memory.id] = { createdAt: memory.createdAt, updatedAt: memory.updatedAt };
  }
  writeFacts(memories.map((m) => m.text), index);
}

/** In file order, which is newest first. */
export function listMemories(): Memory[] {
  return load();
}

export function memoryCount(): number {
  return load().length;
}

export interface RememberResult {
  memory: Memory;
  /** True when this restated something already known rather than adding to it. */
  wasAlreadyKnown: boolean;
}

export function remember(rawText: string): RememberResult {
  const text = rawText.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("There's nothing there to remember, sir.");
  if (text.length > 400) {
    throw new Error("That's too long to keep as a single memory, sir — give me the short version.");
  }

  const memories = load();
  const key = normalise(text);

  // Re-stating a known fact refreshes it instead of duplicating it. The better
  // wording is kept rather than the newest: speech arrives without capitals or
  // punctuation, so "his sister is called maja" should not be allowed to
  // overwrite "His sister is called Maja."
  const existingAt = memories.findIndex((m) => normalise(m.text) === key);
  if (existingAt !== -1) {
    const [existing] = memories.splice(existingAt, 1);
    existing.updatedAt = Date.now();
    if (text.length > existing.text.length) {
      existing.text = text;
      existing.id = idFor(text);
    }
    memories.unshift(existing);
    save(memories);
    return { memory: existing, wasAlreadyKnown: true };
  }

  const memory: Memory = {
    id: idFor(text),
    text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Newest at the top of the file, so reading it top-down reads as current.
  memories.unshift(memory);
  save(memories.slice(0, MAX_MEMORIES));

  return { memory, wasAlreadyKnown: false };
}

/** Forget by id, or by whichever memory best matches the words given. */
export function forget(query: string): Memory | null {
  const memories = load();
  const needle = normalise(query);
  if (!needle) return null;

  let index = memories.findIndex((m) => m.id === query.trim());

  if (index === -1) {
    // Otherwise take the memory sharing the most words with the request.
    const words = new Set(needle.split(" ").filter((w) => w.length > 2));
    let best = -1;
    let bestScore = 0;
    memories.forEach((memory, i) => {
      const memoryWords = new Set(normalise(memory.text).split(" "));
      let score = 0;
      for (const word of words) if (memoryWords.has(word)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    // One incidental word in common isn't a match.
    if (bestScore >= 2 || (bestScore === 1 && words.size === 1)) index = best;
  }

  if (index === -1) return null;
  const [removed] = memories.splice(index, 1);
  save(memories);
  return removed;
}

export function forgetAll(): number {
  const count = load().length;
  save([]);
  return count;
}

/**
 * The facts, formatted for the system prompt. Most recently touched first,
 * trimmed to a budget so a long history can never crowd out the instructions
 * that make JARVIS himself.
 */
export function memoriesForPrompt(budget = MAX_PROMPT_CHARS): string {
  const memories = listMemories();
  if (memories.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const memory of memories) {
    const line = `- ${memory.text}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}
