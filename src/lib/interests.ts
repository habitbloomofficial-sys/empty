import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { getSetting } from "./settings";

// What he actually cares about.
//
// The point of this is to make "is this worth mentioning to him" answerable
// with something better than a guess. Something trending is not interesting;
// something trending IN A THING HE HAS ASKED ABOUT is. Without this, an
// assistant with initiative is just an assistant that interrupts.
//
// Two sources. A list he can type in Settings, which is explicit and wins; and
// what he has actually asked for, which is honest about him in a way a typed
// list never is — nobody writes down that they have looked up the same game
// nine times this month.
//
// Nothing here is sent anywhere. It is a word-count file on his own disk.

const STORE = path.join(process.cwd(), "data", "interests.json");

/** Never treat these as a topic; they are the scaffolding of every request. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "what", "when", "where", "how",
  "why", "who", "can", "you", "please", "open", "play", "show", "find", "search",
  "make", "video", "videos", "watch", "youtube", "new", "latest", "about", "from",
  "into", "some", "any", "all", "more", "most", "best", "good", "have", "has",
  "did", "does", "will", "would", "could", "should", "just", "like", "get",
  "jarvis", "axis", "sir", "thing", "things", "stuff", "one", "two",
  // Generic media words. "trailer" matching would fire on every trailer ever
  // made, which is the opposite of knowing what he follows.
  "trailer", "trailers", "clip", "clips", "episode", "official", "full",
  "review", "reviews", "update", "updates", "part", "release", "announcement",
]);

interface Store {
  /** topic -> how many times he has come back to it */
  counts: Record<string, number>;
  /** topic -> when it was last mentioned, so a stale obsession fades */
  lastAt: Record<string, number>;
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf-8")) as Partial<Store>;
    return {
      counts: typeof parsed.counts === "object" && parsed.counts ? parsed.counts : {},
      lastAt: typeof parsed.lastAt === "object" && parsed.lastAt ? parsed.lastAt : {},
    };
  } catch {
    return { counts: {}, lastAt: {} };
  }
}

function write(store: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  writeFileAtomic(STORE, JSON.stringify(store, null, 2));
}

/** Words worth remembering out of something he asked for. */
export function topicsIn(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));

  // Pairs as well as single words: "grand theft" and "theft auto" between them
  // identify a thing that neither "grand" nor "auto" does.
  const pairs: string[] = [];
  for (let i = 0; i < words.length - 1; i++) pairs.push(`${words[i]} ${words[i + 1]}`);

  return [...new Set([...words, ...pairs])].slice(0, 12);
}

/** He asked for something; remember what it was about. */
export function noteInterest(text: string, now = Date.now()): void {
  const topics = topicsIn(text);
  if (topics.length === 0) return;

  const store = read();
  for (const topic of topics) {
    store.counts[topic] = (store.counts[topic] ?? 0) + 1;
    store.lastAt[topic] = now;
  }

  // Keep the file from growing forever: drop the long tail of things mentioned
  // once, months ago, which is nearly all of it.
  const entries = Object.entries(store.counts);
  if (entries.length > 400) {
    const cutoff = now - 90 * 86_400_000;
    for (const [topic, count] of entries) {
      if (count <= 1 && (store.lastAt[topic] ?? 0) < cutoff) {
        delete store.counts[topic];
        delete store.lastAt[topic];
      }
    }
  }
  write(store);
}

export interface Interest {
  topic: string;
  /** How strongly, 0 to 1. Typed-in interests come back as 1. */
  weight: number;
  stated: boolean;
}

/**
 * What he is interested in, strongest first.
 *
 * Recency counts as well as frequency: something asked about nine times last
 * spring is not what he is on about this week, and treating it as though it
 * were is how an assistant ends up bringing up an old hobby forever.
 */
export function interests(now = Date.now(), limit = 40): Interest[] {
  const stated = (getSetting("INTERESTS") ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((topic): Interest => ({ topic, weight: 1, stated: true }));

  const store = read();
  const learned = Object.entries(store.counts)
    .map(([topic, count]): Interest => {
      const ageDays = (now - (store.lastAt[topic] ?? 0)) / 86_400_000;
      // Halves every three weeks.
      const recency = Math.pow(0.5, ageDays / 21);
      return { topic, weight: Math.min(0.95, (count / 8) * recency), stated: false };
    })
    .filter((entry) => entry.weight > 0.08);

  const seen = new Set(stated.map((entry) => entry.topic));
  const merged = [...stated, ...learned.filter((entry) => !seen.has(entry.topic))];
  return merged.sort((a, b) => b.weight - a.weight).slice(0, limit);
}

export interface InterestMatch {
  matched: boolean;
  /** 0 to 1 — how much this looks like something he cares about. */
  score: number;
  /** The topics that matched, for saying WHY out loud. */
  because: string[];
}

/**
 * Does this look like something he would want to know about?
 *
 * Two-word topics are worth far more than single words: "grand theft" matching
 * is evidence, "trailer" matching is not. That ratio is what stops every new
 * video on earth looking like a match.
 */
export function matchesInterests(text: string, now = Date.now()): InterestMatch {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  const because: string[] = [];
  let score = 0;

  for (const interest of interests(now)) {
    if (!haystack.includes(` ${interest.topic} `)) continue;
    const phrase = interest.topic.includes(" ");
    score += interest.weight * (phrase ? 1 : 0.35) * (interest.stated ? 1.2 : 1);
    because.push(interest.topic);
    if (because.length >= 4) break;
  }

  const capped = Math.min(1, score);
  return { matched: capped >= 0.5, score: Number(capped.toFixed(2)), because };
}
