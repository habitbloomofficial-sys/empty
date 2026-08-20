import { detectWakeWord } from "./wakeWord";

// Deciding whether something heard was actually meant for JARVIS.
//
// An always-open microphone hears everything: a mouse click, a door, the
// television, you talking to somebody else in the room. Worse, speech-to-text
// does not return nothing when it is given nothing — asked to transcribe
// silence it invents the most likely thing a person might have said, which is
// why "you", "Thank you." and "Thanks for watching!" are the classic outputs
// of a model listening to an empty room. Passing any of that to the assistant
// means he interrupts himself to answer a noise.
//
// So: two questions, in order. Was that speech at all? And was it addressed to
// him? Both are answered here, before anything reaches the model.

/**
 * What speech-to-text produces from silence and from room noise.
 *
 * These are whole-utterance matches, never substrings — "thanks for the help
 * with the video" is a real request that happens to start with "thanks".
 */
const HALLUCINATIONS = new Set([
  // Whisper's greatest hits when handed an empty room.
  "you",
  "thank you",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for watching the video",
  "bye",
  "goodbye",
  "okay",
  "ok",
  "so",
  "the",
  "a",
  "and",
  "i",
  "yeah",
  "yep",
  "uh",
  "um",
  "erm",
  "hmm",
  "mm",
  "mhm",
  "ah",
  "oh",
  "eh",
  "huh",
  "hi",
  "hello",
  "please subscribe",
  "subscribe",
  // Bracketed annotations some engines emit for non-speech audio.
  "blank audio",
  "silence",
  "music",
  "inaudible",
  "noise",
  "applause",
  "laughter",
  "beep",
  "click",
  "clicking",
  "typing",
  "coughing",
  // Burned-in subtitle credits that appear from nowhere.
  "amara org community",
  "subtitles by the amara org community",
  "transcription by castingwords",
]);

/** Two-letter words that mean something when said on their own. */
const SHORT_BUT_REAL = new Set(["no", "go", "up"]);

/** Lowercase, strip punctuation and annotation brackets, collapse spaces. */
export function cleanTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[[(<][^\])>]*[\])>]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether this looks like a person saying something, as opposed to a
 * transcriber's best guess at a noise.
 */
export function isMeaningfulSpeech(text: string): boolean {
  const clean = cleanTranscript(text);
  if (!clean) return false;
  // No letters at all: a stray digit or a lone punctuation mark.
  if (!/\p{L}/u.test(clean)) return false;
  if (HALLUCINATIONS.has(clean)) return false;

  const words = clean.split(" ");
  // A single word has to be a real one — long enough not to be a grunt, and
  // not one of the fillers above. A handful of short ones are genuine answers
  // to a question he just asked, so they're named rather than measured.
  if (words.length === 1) return words[0].length >= 3 || SHORT_BUT_REAL.has(words[0]);
  return true;
}

export type VoiceVerdict =
  /** Say something about it. */
  | { act: true; text: string; addressed: boolean }
  /** Ignore it. Not an error — the room is simply not talking to him. */
  | { act: false; reason: "noise" | "not-addressed" };

export interface ScreenOptions {
  /**
   * True when he may only act if his name is used: the microphone is open
   * continuously and this isn't the tail of a conversation already underway.
   */
  requireName: boolean;
}

/**
 * The gate. Everything the microphone produces goes through here.
 *
 * When his name is required, it must appear near the start — "Jarvis, open
 * Discord" is being spoken to, "I was telling Jarvis about it" is being spoken
 * about, and the difference matters when the microphone never closes.
 */
export function screenUtterance(transcript: string, options: ScreenOptions): VoiceVerdict {
  if (!isMeaningfulSpeech(transcript)) return { act: false, reason: "noise" };

  const { woke, command } = detectWakeWord(transcript);

  if (woke) {
    // Named him and nothing else: that's an attention-getter, and it should
    // open the floor rather than be sent as a request.
    const rest = command.trim();
    return { act: true, text: rest || transcript.trim(), addressed: true };
  }

  if (options.requireName) return { act: false, reason: "not-addressed" };
  return { act: true, text: transcript.trim(), addressed: false };
}

/**
 * How long after his own reply an unaddressed follow-up still counts as part
 * of the same conversation.
 *
 * Long enough to ask the obvious next thing without repeating his name, short
 * enough that a remark to somebody else a minute later isn't answered.
 */
export const FOLLOW_UP_WINDOW_MS = 20_000;

export function withinFollowUp(lastReplyAt: number, now: number): boolean {
  return lastReplyAt > 0 && now - lastReplyAt <= FOLLOW_UP_WINDOW_MS;
}
