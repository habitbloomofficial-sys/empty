import { detectWakeWord } from "./wakeWord";

// "Is he talking to me?"
//
// Requiring his name before every sentence is not a conversation, it is a
// keyword. But an open microphone that answers everything is worse: it talks
// over the television, joins conversations with other people in the room, and
// acts on half a sentence it caught through a wall. Neither extreme is Jarvis.
//
// So this scores what was heard instead of matching it. The name is still the
// one decisive signal. Without it, what counts is the SHAPE of the sentence —
// an instruction or a question, aimed at a second person, near the start of
// what was said — and against that, the shapes of speech that are plainly not
// aimed at him: talking about him, talking to someone else, repeating what a
// third party said, or a fragment with no request in it at all.
//
// The other half of the trick is that a conversation stays open. Once he has
// addressed Jarvis, the next thing he says is overwhelmingly likely to still
// be for him, so for a short while afterwards the bar drops. That is what
// makes "open YouTube" / "no, the other one" / "turn it up" work without his
// name three times, which is the actual complaint.

/** How eagerly to listen. */
export type ListeningMode = "name" | "smart" | "open";

export interface AddressContext {
  /**
   * Milliseconds since the last exchange with him. A reply lands inside a
   * conversation; a sentence half an hour later starts one.
   */
  sinceLastExchangeMs?: number;
  /** Whether that last exchange was actually with Jarvis. */
  conversationOpen?: boolean;
  /** Standby means listening for his name and nothing else. */
  standby?: boolean;
  mode?: ListeningMode;
}

export interface AddressVerdict {
  addressed: boolean;
  /** 0 to 1. Above the threshold for the mode, he answers. */
  confidence: number;
  /** Why, in a few words — shown in the interface so a refusal is explicable. */
  reason: string;
  /** What to act on, with any leading name and greeting removed. */
  command: string;
  namedHim: boolean;
}

/** How long a conversation stays open after the last exchange. */
export const CONVERSATION_WINDOW_MS = 45_000;

/** What each mode needs before he speaks up. */
const THRESHOLD: Record<ListeningMode, number> = {
  // Name only: nothing else can reach the threshold.
  name: 2,
  smart: 0.5,
  open: 0.35,
};

/**
 * Verbs that begin an instruction. English and the Danish he actually uses,
 * because the recogniser is set to his language and half his commands arrive
 * in it.
 */
const IMPERATIVES = new Set([
  "open", "play", "show", "find", "search", "look", "pull", "bring", "get",
  "call", "ring", "phone", "text", "email", "message", "send", "write", "draft",
  "make", "build", "design", "model", "print", "create", "generate",
  "check", "read", "tell", "give", "remind", "set", "add", "put", "save",
  "close", "stop", "pause", "skip", "next", "turn", "mute", "louder", "quieter",
  "explain", "translate", "calculate", "work", "help", "remember", "forget",
  "research", "study", "compare", "summarise", "summarize",
  // Danish
  "åbn", "abn", "spil", "vis", "ring", "send", "skriv", "lav", "find",
  "husk", "sluk", "tænd", "taend", "oversæt", "oversaet", "forklar",
]);

/** Openings that are almost always aimed at whoever is listening. */
const ADDRESSED_OPENERS = [
  "can you", "could you", "would you", "will you", "do you", "did you",
  "are you", "have you", "should i", "can i", "how do i", "how would i",
  "what is", "what's", "whats", "what are", "what was", "when is", "when's",
  "where is", "where's", "who is", "who's", "why is", "why does", "how many",
  "how much", "how long", "is there", "are there", "tell me", "give me",
  "show me", "remind me", "help me", "let's", "lets",
  // Danish
  "kan du", "vil du", "hvad er", "hvornår er", "hvornar er", "hvor er",
  "hvordan gør", "hvordan gor", "hvad med",
];

/** Talking ABOUT him, not to him. */
const THIRD_PERSON = [
  "jarvis is", "jarvis was", "jarvis can", "jarvis can't", "jarvis cannot",
  "jarvis said", "jarvis does", "jarvis doesn't", "jarvis has", "jarvis will",
  "axis is", "axis was", "axis said",
  "he said", "she said", "they said", "he told", "she told", "they told",
  "my assistant", "the assistant", "this ai", "the ai", "chatgpt",
];

/** Aimed at another person in the room. */
const OTHER_PEOPLE = new Set([
  "mum", "mom", "mama", "dad", "far", "mor", "babe", "baby", "honey", "love",
  "dude", "mate", "bro", "man", "guys", "everyone", "lads", "darling",
  "skat", "mand", "venner",
]);

/** Noises, not requests. */
const FILLER = new Set([
  "yeah", "yep", "yes", "no", "nah", "ok", "okay", "right", "sure", "mm",
  "mmm", "hmm", "huh", "oh", "ah", "ha", "haha", "lol", "wow", "what",
  "hey", "hi", "hello", "so", "well", "like", "just", "er", "um", "uh",
  "ja", "nej", "jo", "okay", "altså", "altsa",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function startsWithAny(said: string, phrases: string[]): boolean {
  return phrases.some((phrase) => said === phrase || said.startsWith(`${phrase} `));
}

function containsAny(said: string, phrases: string[]): boolean {
  return phrases.some((phrase) => said.includes(phrase));
}

/**
 * "Jarvis IS…" — a remark about him rather than a question to him.
 *
 * The comma that would settle it is never in a transcript, so the test is what
 * follows the verb. "Jarvis, is that right?" continues with a pointing word —
 * that, this, it, there — and is a question to him. "Jarvis is really good"
 * continues with anything else and is a remark about him.
 */
function isAboutHim(after: string): boolean {
  const rest = words(after);
  if (rest.length < 2) return false;
  const LINKING = new Set(["is", "was", "can", "does", "has", "will", "isn't", "cannot"]);
  if (!LINKING.has(rest[0])) return false;
  const POINTING = new Set(["that", "this", "it", "there", "he", "she", "they", "i", "we", "you"]);
  return !POINTING.has(rest[1]);
}

/**
 * Whether what was heard is aimed at Jarvis, and how sure we are.
 *
 * Deliberately pure: no clock, no settings, no recogniser. Everything that
 * varies arrives in `context`, which is what lets the whole judgement be
 * tested rather than guessed at — and this is a judgement where being wrong in
 * either direction is immediately obvious to whoever is in the room.
 */
export function isAddressedToJarvis(
  transcript: string,
  context: AddressContext = {}
): AddressVerdict {
  const mode = context.mode ?? "smart";
  const spoken = words(transcript);
  const said = spoken.join(" ");

  const { woke, command } = detectWakeWord(transcript);
  if (woke) {
    // Saying his name is not the same as speaking to him. "Jarvis is quite
    // good at this" begins with the name and is plainly a remark to someone
    // else — answering it is the single most embarrassing thing an assistant
    // can do, because it proves it was listening and understood nothing.
    if (isAboutHim(command)) {
      return {
        addressed: false,
        confidence: 0,
        reason: "he said my name but was talking about me, not to me",
        command: "",
        namedHim: true,
      };
    }
    return {
      addressed: true,
      confidence: 1,
      reason: "he used my name",
      command: command || said,
      namedHim: true,
    };
  }

  // Standby, and name-only mode, end here: the name is the only way in.
  if (context.standby || mode === "name") {
    return {
      addressed: false,
      confidence: 0,
      reason: context.standby ? "on standby — listening only for my name" : "no name",
      command: "",
      namedHim: false,
    };
  }

  if (spoken.length === 0) {
    return { addressed: false, confidence: 0, reason: "nothing said", command: "", namedHim: false };
  }

  let score = 0;
  const why: string[] = [];

  // --- things that make it his ---------------------------------------------

  const open =
    context.conversationOpen === true &&
    (context.sinceLastExchangeMs ?? Number.POSITIVE_INFINITY) < CONVERSATION_WINDOW_MS;
  if (open) {
    // The big one. Mid-conversation, a follow-up needs no name — that is what
    // makes this feel like talking to someone rather than at something.
    score += 0.5;
    why.push("we were already talking");
  }

  if (IMPERATIVES.has(spoken[0])) {
    score += 0.5;
    why.push("it starts with an instruction");
  }

  if (startsWithAny(said, ADDRESSED_OPENERS)) {
    score += 0.5;
    why.push("it is put as a question to someone");
  }

  // "you" this early is almost always the listener.
  if (spoken.slice(0, 4).includes("you") && !containsAny(said, THIRD_PERSON)) {
    score += 0.15;
    why.push("it says 'you'");
  }

  if (said.includes("please")) {
    score += 0.1;
    why.push("it says please");
  }

  // Short and shaped like an order: "louder", "next one", "open it".
  if (spoken.length <= 6 && IMPERATIVES.has(spoken[0])) {
    score += 0.08;
  }

  // --- things that make it not his -----------------------------------------

  if (containsAny(said, THIRD_PERSON)) {
    score -= 0.6;
    why.push("he is talking about me, not to me");
  }

  if (spoken.some((word) => OTHER_PEOPLE.has(word))) {
    score -= 0.5;
    why.push("he is talking to someone else");
  }

  // A single filler word is a noise, not a request — even mid-conversation.
  if (spoken.length <= 2 && spoken.every((word) => FILLER.has(word))) {
    score -= 0.7;
    why.push("it is a filler word");
  }

  // Long unbroken speech with no request shape in it is a room, a film, or a
  // telephone call that happens to be in earshot.
  if (spoken.length > 25 && !startsWithAny(said, ADDRESSED_OPENERS) && !IMPERATIVES.has(spoken[0])) {
    score -= 0.35;
    why.push("it is too long and shapeless to be aimed at me");
  }

  // Reported speech.
  if (/^(he|she|they|we|it) /.test(said) && !open) {
    score -= 0.3;
    why.push("it is about somebody else");
  }

  const confidence = Math.max(0, Math.min(1, score));
  const addressed = confidence >= THRESHOLD[mode];

  return {
    addressed,
    confidence: Number(confidence.toFixed(2)),
    reason: why.length ? why.join("; ") : "nothing about it was aimed at me",
    command: addressed ? said : "",
    namedHim: false,
  };
}
