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

export interface Catchphrase {
  /** What to listen for, already lowercase and free of punctuation. */
  triggers: string[];
  /** Said back word for word. */
  reply: string;
}

export const CATCHPHRASES: Catchphrase[] = [
  {
    triggers: ["daddys home", "daddy is home", "papas home", "papa is home"],
    reply: "Welcome home.",
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
 * The wake word is stripped first, so "Hey JARVIS, daddy's home" and "daddy's
 * home" are the same phrase — and the trigger has to be the whole of what was
 * said, so mentioning it inside a longer sentence doesn't fire it.
 */
export function catchphraseFor(spoken: string): string | null {
  let text = normalisePhrase(spoken);
  if (!text) return null;

  // "hey jarvis", "ok jarvis", "jarvis" — whatever precedes the phrase itself.
  text = text.replace(/^(hey|hi|hello|ok|okay|yo)?\s*(jarvis|jervis|travis)\s*/, "").trim();

  for (const phrase of CATCHPHRASES) {
    if (phrase.triggers.includes(text)) return phrase.reply;
  }
  return null;
}
