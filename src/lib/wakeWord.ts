// "Hey JARVIS" is never what the recogniser actually hears. Across a room, on
// a laptop microphone, it comes back as "hey Travis", "hi Jarvis", "a service",
// "jarvis." with a full stop. Matching the literal string would mean the wake
// word almost never works; matching too loosely would mean he wakes up during
// a phone call. This sits in between: the name has to be there, spelled close
// enough, as a word of its own.

const WAKE_NAME = "jarvis";

/** Mishearings common enough to accept outright. */
const ALIASES = new Set([
  "travis",
  "jervis",
  "javis",
  "jarvis",
  "garvis",
  "charvis",
  "jarviss",
  "yarvis",
]);

/** Words that may lead the name, kept only to recognise the fuller phrase. */
const GREETINGS = new Set(["hey", "hi", "hello", "ok", "okay", "yo", "hej"]);

function editDistance(a: string, b: string): number {
  // Ordinary Levenshtein, one row at a time — the strings here are one word.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }

  return previous[b.length];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isName(word: string): boolean {
  if (ALIASES.has(word)) return true;
  // One character out covers most of what a microphone gets wrong; two would
  // start matching ordinary words like "service".
  return Math.abs(word.length - WAKE_NAME.length) <= 1 && editDistance(word, WAKE_NAME) <= 1;
}

export interface WakeMatch {
  /** Whether the wake word was heard at all. */
  woke: boolean;
  /**
   * Anything said after the name in the same breath — "hey Jarvis, open
   * YouTube" should not need saying twice.
   */
  command: string;
}

export function detectWakeWord(transcript: string): WakeMatch {
  const spoken = words(transcript);

  for (let i = 0; i < spoken.length; i++) {
    if (!isName(spoken[i])) continue;

    // Only wake on the name near the start of what was said. Deeper in, it's
    // far more likely to be someone talking *about* him than *to* him.
    const lead = spoken.slice(0, i);
    if (lead.length > 2 || lead.some((word) => !GREETINGS.has(word))) continue;

    return { woke: true, command: spoken.slice(i + 1).join(" ") };
  }

  return { woke: false, command: "" };
}
