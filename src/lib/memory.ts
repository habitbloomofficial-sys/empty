import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// What JARVIS knows about you between sessions. A conversation is forgotten
// when the page reloads; this isn't. It's deliberately small and legible —
// short facts in a file you can read, not embeddings in a database — because
// the useful kind of memory here is "he takes his coffee black" and "his
// sister is called Maja", and a hundred of those fit in a prompt with room to
// spare.
//
// The store is behind this module rather than reached into directly, so a
// hosted memory service can be added later without touching anything else.

const MEMORY_PATH = path.join(process.cwd(), "data", "memory.json");

/** Beyond this, the oldest unused memories are dropped. */
const MAX_MEMORIES = 200;
/** Roughly how much of the prompt memory may occupy. */
const MAX_PROMPT_CHARS = 2400;

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  /** Bumped whenever the fact is re-stated, so stale ones fall off first. */
  updatedAt: number;
}

function load(): Memory[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Memory =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as Memory).id === "string" &&
        typeof (entry as Memory).text === "string"
    );
  } catch {
    // No file yet, or an unreadable one — start from nothing rather than
    // taking the assistant down.
    return [];
  }
}

function save(memories: Memory[]): void {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memories, null, 2), { mode: 0o600 });
}

/** For comparing two statements of the same fact. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function listMemories(): Memory[] {
  return load().sort((a, b) => b.updatedAt - a.updatedAt);
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
  const existing = memories.find((m) => normalise(m.text) === key);
  if (existing) {
    existing.updatedAt = Date.now();
    if (text.length > existing.text.length) existing.text = text;
    save(memories);
    return { memory: existing, wasAlreadyKnown: true };
  }

  const memory: Memory = {
    id: crypto.randomBytes(6).toString("hex"),
    text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  memories.push(memory);

  // Oldest-touched first out, so things that keep coming up stay.
  memories.sort((a, b) => b.updatedAt - a.updatedAt);
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
 * The memories, formatted for the system prompt. Most recently touched first,
 * trimmed to a budget so a long history can never crowd out the instructions
 * that make JARVIS himself.
 */
export function memoriesForPrompt(): string {
  const memories = listMemories();
  if (memories.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const memory of memories) {
    const line = `- ${memory.text}`;
    if (used + line.length > MAX_PROMPT_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}
