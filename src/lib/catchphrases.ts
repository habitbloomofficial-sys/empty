// Phrases with a fixed answer.
//
// These never reach the model. A model asked to "always reply with exactly X"
// will mostly comply and occasionally improvise, which is the one thing a
// catchphrase cannot survive — the whole point is that the answer is the same
// every single time. Matching here also means the reply is instant, with no
// round trip at all.
//
// Matching is deliberately forgiving, because these arrive through
// speech-to-text: apostrophes vanish, "daddy's" becomes "daddys", and a
// trailing full stop appears or doesn't.

import { detectWakeWord } from "./wakeWord";

export interface Catchphrase {
  /** What to listen for, already lowercase and free of punctuation. */
  triggers: string[];
  /**
   * Said back word for word. `{title}` becomes whatever he's been told to call
   * you, so the fixed reply still follows the Personality setting rather than
   * being the one line in the app that ignores it.
   */
  reply: string;
}

export const CATCHPHRASES: Catchphrase[] = [
  {
    triggers: ["daddys home", "daddy is home", "papas home", "papa is home"],
    reply: "Welcome home, {title}.",
  },
];

/** Strip everything that speech-to-text is inconsistent about. */
export function normalisePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The fixed reply for something said, or null.
 *
 * The wake word is stripped first, so "Hey Axis, daddy's home" and "daddy's
 * home" are the same phrase — and the trigger has to be the whole of what was
 * said, so mentioning it inside a longer sentence doesn't fire it.
 */
export function catchphraseFor(spoken: string, title = "sir"): string | null {
  const cleaned = normalisePhrase(spoken);
  if (!cleaned) return null;

  // Strip the wake word using the detector rather than a second list of names
  // kept here. Two lists is one too many: renaming him left this copy behind,
  // and "Hey Jarvis, daddy's home" quietly stopped working.
  const woken = detectWakeWord(cleaned);
  const text = woken.woke ? woken.command.trim() : cleaned;

  for (const phrase of CATCHPHRASES) {
    if (phrase.triggers.includes(text)) {
      return phrase.reply.replace(/\{title\}/g, title);
    }
  }
  return null;
}
