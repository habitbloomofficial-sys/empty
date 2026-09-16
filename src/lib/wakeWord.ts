import { editDistance } from "./stringMatch";

// "Hey Jarvis" is never what the recogniser actually hears. Across a room, on
// a laptop microphone, it comes back as "hey Travis", "hi Jarvis", "a service",
// "jarvis." with a full stop. Matching the literal string would mean the wake
// word almost never works; matching too loosely would mean he wakes up during
// a phone call. This sits in between: the name has to be there, spelled close
// enough, as a word of its own, and near the start of what was said.

/**
 * He answers to Jarvis, and still to Axis.
 *
 * Jarvis is the name now. Axis stays because it was the name for a while and
 * nobody unlearns one in a day — keeping it costs nothing, and the alternative
 * is him ignoring the weeks of saying it out of habit.
 *
 * Axis is the harder of the two for a microphone: it is short, and its
 * commonest mishearing — "access" — is an ordinary English word, so it is
 * accepted only in the leading position, where "access my email" cannot reach
 * it.
 */
const WAKE_NAMES = ["jarvis", "axis"];

/** Mishearings common enough to accept outright. */
const ALIASES = new Set([
  // Axis, the old name, still answered to
  "axis",
  "axes",
  "access",
  "aksis",
  "axus",
  "acksis",
  "axiss",
  // Jarvis
  "jarvis",
  "travis",
  "jervis",
  "javis",
  "garvis",
  "charvis",
  "jarviss",
  "yarvis",
]);

/** Words that may lead the name, kept only to recognise the fuller phrase. */
const GREETINGS = new Set(["hey", "hi", "hello", "ok", "okay", "yo", "hej"]);

/**
 * Telling him to stop, and telling him to come back.
 *
 * Both are matched only after his name. "Stand by" and "quiet" are ordinary
 * English, and an assistant that goes silent because a film said "be quiet" is
 * a worse assistant than one that needs his name first.
 */
const STANDBY_PHRASES = [
  "standby", "stand by", "stand by mode", "standby mode",
  "go to sleep", "go quiet", "be quiet", "shut up", "shush",
  "stop listening", "stop talking", "leave me alone", "give me a minute",
  "sleep", "quiet", "silence",
];

const RESUME_PHRASES = [
  "wake up", "wake", "resume", "come back", "are you there", "you there",
  "i'm back", "im back", "carry on", "back on", "stop standby", "end standby",
];

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
  // start matching ordinary words like "service" or "basis".
  return WAKE_NAMES.some(
    (name) => Math.abs(word.length - name.length) <= 1 && editDistance(word, name) <= 1
  );
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

/** What he was told to do about listening, if anything. */
export type StandbyOrder = "standby" | "resume" | null;

/**
 * "Jarvis, standby" and "Jarvis, wake up".
 *
 * Deliberately built on detectWakeWord rather than beside it: the name has to
 * be recognised the same way here as anywhere else, mishearings and all, or
 * "hey access standby" would go unheard and he would keep talking.
 */
export function detectStandbyOrder(transcript: string): StandbyOrder {
  const { woke, command } = detectWakeWord(transcript);
  if (!woke) return null;

  const said = words(command).join(" ");
  if (!said) return null;

  // Longest first, so "stand by mode" is not matched as "stand by" with a
  // trailing word that stops it being an exact order.
  const matches = (phrases: string[]) =>
    phrases.some((phrase) => said === phrase || said.startsWith(`${phrase} `) || said.startsWith(`${phrase},`));

  if (matches(STANDBY_PHRASES)) return "standby";
  if (matches(RESUME_PHRASES)) return "resume";
  return null;
}
