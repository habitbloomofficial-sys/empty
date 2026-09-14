import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { hasInitiative } from "./listening";
import { trending, type TrendingItem } from "./trending";
import { isTrendingAvailable } from "./trending";

// Doing something without being asked.
//
// This is the most dangerous file in the project, and not for a security
// reason. Something that acts on its own is delightful exactly as often as it
// is right, and infuriating every other time — and unlike a wrong answer, a
// wrong action cannot be ignored: it has already opened the tab, already
// interrupted, already been wrong out loud.
//
// So every gate here is deliberately set against acting:
//
//   - OFF unless he turned it on. Not a default.
//   - Only for things that match what he has actually been asking about,
//     scored in interests.ts, above a bar that a generic viral video cannot
//     reach.
//   - Only for something genuinely new — a fortnight-old video is not news
//     however much he likes the game.
//   - At most once in the cooling-off period, however much is happening.
//   - Never the same thing twice, ever.
//   - Never while he is on standby, and never while he is mid-conversation.
//
// And one rule that is not a gate: whatever it does, it says. An action taken
// silently is indistinguishable from a bug.

const STORE = path.join(process.cwd(), "data", "initiative.json");

/** Nothing unprompted more often than this. */
export const COOLDOWN_MS = 3 * 60 * 60 * 1000;
/** Older than this is not news, whoever it is for. */
export const FRESH_HOURS = 36;
/** How well it has to match him before it is worth interrupting for. */
export const MATCH_BAR = 0.62;

interface Store {
  lastActedAt: number;
  /** Ids already raised, so nothing is ever mentioned twice. */
  seen: string[];
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf-8")) as Partial<Store>;
    return {
      lastActedAt: typeof parsed.lastActedAt === "number" ? parsed.lastActedAt : 0,
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { lastActedAt: 0, seen: [] };
  }
}

function write(store: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  // Keep the last few hundred, so "never twice" survives restarts without the
  // file growing without limit.
  writeFileAtomic(STORE, JSON.stringify({ ...store, seen: store.seen.slice(-300) }, null, 2));
}

export interface Impulse {
  /** What he'd be told. */
  item: TrendingItem;
  /** Why it got through — the topics that matched. */
  because: string[];
  /** Whether it is strong enough to OPEN, rather than merely mention. */
  openIt: boolean;
  fact: string;
}

export type InitiativeDecision =
  | { status: "off" | "unavailable" | "too-soon" | "nothing" | "busy"; reason: string }
  | { status: "act"; impulse: Impulse };

export interface InitiativeContext {
  standby?: boolean;
  /** True while he is mid-exchange — interrupting a conversation is rude. */
  talking?: boolean;
  now?: number;
}

/**
 * Whether there is anything worth doing unasked, and what.
 *
 * Every refusal names itself. "nothing" and "too-soon" look identical from
 * outside and mean completely different things when this is not behaving — one
 * is working correctly and the other may be a clock bug.
 */
export async function decideInitiative(
  context: InitiativeContext = {}
): Promise<InitiativeDecision> {
  const now = context.now ?? Date.now();

  if (!hasInitiative()) {
    return { status: "off", reason: "acting unasked is switched off in Settings" };
  }
  if (context.standby) return { status: "busy", reason: "he asked for quiet" };
  if (context.talking) return { status: "busy", reason: "we are mid-conversation" };
  if (!isTrendingAvailable()) {
    return { status: "unavailable", reason: "no YouTube key, so I cannot see what is trending" };
  }

  const store = read();
  const since = now - store.lastActedAt;
  if (store.lastActedAt > 0 && since < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - since) / 60_000);
    return { status: "too-soon", reason: `spoke up unasked ${Math.round(since / 60_000)} minutes ago; ${wait} to go` };
  }

  let items: TrendingItem[];
  try {
    items = await trending({ matchingOnly: true, limit: 40 });
  } catch {
    return { status: "unavailable", reason: "YouTube would not answer" };
  }

  const seen = new Set(store.seen);
  const candidate = items.find(
    (item) =>
      !seen.has(item.id) &&
      item.match.score >= MATCH_BAR &&
      item.ageHours !== null &&
      item.ageHours <= FRESH_HOURS
  );

  if (!candidate) {
    return { status: "nothing", reason: "nothing new enough, or close enough to what he follows" };
  }

  const hours = Math.round(candidate.ageHours ?? 0);
  const when = hours < 1 ? "in the last hour" : hours < 24 ? `${hours} hours ago` : "yesterday";

  return {
    status: "act",
    impulse: {
      item: candidate,
      because: candidate.match.because,
      // Opening a page unasked is a bigger liberty than mentioning one, so it
      // takes a clearly stronger match than the bar to merely speak.
      openIt: candidate.match.score >= 0.8,
      fact:
        `"${candidate.title}" went up ${when} on ${candidate.channel} and is trending. ` +
        `He follows ${candidate.match.because.slice(0, 2).join(" and ")}.`,
    },
  };
}

/** Record that it acted, so the cooling-off period starts and this never repeats. */
export function markActed(id: string, now = Date.now()): void {
  const store = read();
  store.lastActedAt = now;
  if (!store.seen.includes(id)) store.seen.push(id);
  write(store);
}
