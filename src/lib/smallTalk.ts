// Lines Axis says on his own initiative, so a silence is never just silence.
//
// The reason these exist: nothing can be spoken until the model produces its
// first token, and that can be seconds away — thinking happens before any
// output. Waiting on the model means waiting in silence, so these run on a
// timer instead and fill the gap the moment there is one.

// Written with a {title} placeholder rather than a fixed "sir", because what
// he calls you is yours to choose.
const OPENERS = [
  "One moment, {title}.",
  "Right away, {title}.",
  "On it, {title}.",
  "Let me see, {title}.",
  "Certainly, {title}.",
  "Of course, {title}.",
];

const PLAYFUL_OPENERS = [
  "Already on it, {title}.",
  "Consider it done — well, nearly.",
  "Watch this, {title}.",
  "This is what I was built for, apparently.",
  "Say no more, {title}.",
];

const STILL_WORKING = [
  "Still working on it, {title}.",
  "Bear with me, {title}.",
  "Nearly there, {title}.",
  "Won't be a moment, {title}.",
];

const PLAYFUL_STILL_WORKING = [
  "Still going, {title} — the internet is being difficult.",
  "Almost. Do try to contain your excitement.",
  "Any second now. I can feel it.",
  "Nearly there — I'm working very hard, in case that wasn't obvious.",
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

  constructor(
    private readonly title = "sir",
    private readonly playful = false
  ) {}

  private say(lines: string[]): string {
    this.last = pick(lines, this.last);
    return this.last.replace(/\{title\}/g, this.title);
  }

  opener(): string {
    return this.say(this.playful ? [...OPENERS, ...PLAYFUL_OPENERS] : OPENERS);
  }

  stillWorking(): string {
    return this.say(this.playful ? [...PLAYFUL_STILL_WORKING, ...STILL_WORKING] : STILL_WORKING);
  }
}

/**
 * A spoken summary for a turn that did something but said nothing. Some
 * replies come back with tool calls and no words at all, and an action
 * performed in silence is the thing that makes him feel broken.
 */
export function describeActions(summaries: string[], title = "sir"): string {
  const done = summaries.filter(Boolean);
  if (done.length === 0) return "";
  if (done.length === 1) return `${done[0]}, ${title}.`;
  return `${done.slice(0, -1).join(", ")}, and ${done[done.length - 1]}, ${title}.`;
}
