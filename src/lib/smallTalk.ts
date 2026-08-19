// Lines JARVIS says on his own initiative, so a silence is never just silence.
//
// The reason these exist: nothing can be spoken until the model produces its
// first token, and that can be seconds away — thinking happens before any
// output. Waiting on the model means waiting in silence, so these run on a
// timer instead and fill the gap the moment there is one.

const OPENERS = [
  "One moment, sir.",
  "Right away, sir.",
  "On it, sir.",
  "Let me see, sir.",
  "Certainly, sir.",
  "Of course, sir.",
];

const STILL_WORKING = [
  "Still working on it, sir.",
  "Bear with me, sir.",
  "Nearly there, sir.",
  "Won't be a moment, sir.",
];

/**
 * Pick a line, never the same one twice running. Repetition is what makes
 * stock phrases sound like a machine.
 */
function pick(lines: string[], avoid: string | null): string {
  const choices = lines.filter((line) => line !== avoid);
  const pool = choices.length > 0 ? choices : lines;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Keeps track of what was said last so the next line differs. */
export class SmallTalk {
  private last: string | null = null;

  opener(): string {
    this.last = pick(OPENERS, this.last);
    return this.last;
  }

  stillWorking(): string {
    this.last = pick(STILL_WORKING, this.last);
    return this.last;
  }
}

/**
 * A spoken summary for a turn that did something but said nothing. Some
 * replies come back with tool calls and no words at all, and an action
 * performed in silence is the thing that makes him feel broken.
 */
export function describeActions(summaries: string[]): string {
  const done = summaries.filter(Boolean);
  if (done.length === 0) return "";
  if (done.length === 1) return `${done[0]}, sir.`;
  return `${done.slice(0, -1).join(", ")}, and ${done[done.length - 1]}, sir.`;
}
