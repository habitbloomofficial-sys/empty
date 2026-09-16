import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";

// Who he is, as opposed to what he has said.
//
// memory.ts holds facts he has told Jarvis and sessions.ts holds what happened.
// This is the smaller, slower-moving thing underneath both: the handful of
// facts that shape every answer rather than any particular one. His age. What
// he is building. What he believes. Things that are true on a Tuesday in
// March as much as they were in September.
//
// One decision matters more than the rest of this file: THE BIRTH DATE IS
// STORED, NOT THE AGE. Writing down "13" is writing down something that is
// wrong within a year and wrong silently — he would be sixteen and being
// spoken to as a thirteen-year-old, with nothing anywhere to explain it. A
// date is true forever and the age is worked out fresh every time it is asked
// for.

const STORE = path.join(process.cwd(), "data", "profile.json");

export interface Profile {
  /** Birth date, ISO yyyy-mm-dd. The age is derived, never stored. */
  birthday?: string;
  /** What he believes, in his own words. */
  faith?: string;
  /** What he is building or working towards. */
  ventures: string[];
  /** Durable facts about him that shape how to answer. */
  about: string[];
  updatedAt: number;
}

/**
 * What he told Jarvis about himself, shipped in the code rather than left in a
 * file on one machine.
 *
 * data/ is gitignored — correctly, it holds his keys — which means anything
 * written there on one computer does not exist on the next one. Seeding from
 * here is what makes these facts survive a reinstall, a new machine, or a
 * `git clean`, with nothing for him to retype.
 *
 * It is a SEED, not a truth: the moment a profile file exists, this is never
 * consulted again, so anything he corrects stays corrected.
 */
const SEED: Omit<Profile, "updatedAt"> = {
  birthday: "2013-02-12",
  faith: "Christian",
  ventures: [
    "Building a Shopify dropshipping store, and working on it himself rather than reading about it",
  ],
  about: [
    "Loves a side hustle, and is genuinely interested in making money rather than only talking about it",
    "Wants to learn technical engineering as a subject, not just have parts designed for him",
  ],
};

function read(): Profile {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf-8")) as Partial<Profile>;
    return {
      birthday: typeof parsed.birthday === "string" ? parsed.birthday : undefined,
      faith: typeof parsed.faith === "string" ? parsed.faith : undefined,
      ventures: Array.isArray(parsed.ventures) ? parsed.ventures.filter((v) => typeof v === "string") : [],
      about: Array.isArray(parsed.about) ? parsed.about.filter((v) => typeof v === "string") : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    // No file yet (or an unreadable one): start from what he has already said.
    return { ...SEED, ventures: [...SEED.ventures], about: [...SEED.about], updatedAt: 0 };
  }
}

function write(profile: Profile): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  writeFileAtomic(STORE, JSON.stringify(profile, null, 2));
}

export function profile(): Profile {
  return read();
}

/**
 * How old he is today.
 *
 * Whole years, and the birthday has to have actually happened this year —
 * subtracting the years alone makes him a year older for the six weeks before
 * his birthday, which is exactly the sort of small wrongness that makes an
 * assistant feel like it is guessing.
 */
export function age(now = new Date()): number | null {
  const born = profile().birthday;
  if (!born) return null;
  const date = new Date(`${born}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  let years = now.getFullYear() - date.getFullYear();
  const monthsToGo = now.getMonth() - date.getMonth();
  if (monthsToGo < 0 || (monthsToGo === 0 && now.getDate() < date.getDate())) years--;
  return years >= 0 && years < 130 ? years : null;
}

/** Whether his birthday is today, so it can be said rather than missed. */
export function isBirthday(now = new Date()): boolean {
  const born = profile().birthday;
  if (!born) return false;
  const date = new Date(`${born}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

/** Days until the next one, for anything that wants to see it coming. */
export function daysToBirthday(now = new Date()): number | null {
  const born = profile().birthday;
  if (!born) return null;
  const date = new Date(`${born}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const next = new Date(now.getFullYear(), date.getMonth(), date.getDate());
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    next.setFullYear(next.getFullYear() + 1);
  }
  return Math.round((next.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

export function noteAboutHim(fact: string): Profile {
  const tidy = fact.trim();
  if (!tidy) throw new Error("There's nothing there to remember, sir.");

  const current = read();
  // Said twice is still one fact.
  if (!current.about.some((entry) => entry.toLowerCase() === tidy.toLowerCase())) {
    current.about.push(tidy);
  }
  current.updatedAt = Date.now();
  write(current);
  return current;
}

export function setProfile(changes: Partial<Omit<Profile, "updatedAt">>): Profile {
  const current = read();
  const next: Profile = {
    ...current,
    ...changes,
    ventures: changes.ventures ?? current.ventures,
    about: changes.about ?? current.about,
    updatedAt: Date.now(),
  };
  write(next);
  return next;
}

/**
 * The paragraph the system prompt carries.
 *
 * Deliberately short. This is loaded on every single turn, so every sentence
 * in it is paid for forever — it holds what changes an ANSWER, and nothing
 * that merely describes him.
 */
export function profileSummary(now = new Date()): string {
  const me = read();
  const years = age(now);
  const lines: string[] = [];

  if (years !== null) {
    lines.push(
      `He is ${years}. Pitch everything at someone of that age who is sharp and ` +
        `genuinely trying: explain properly, never talk down, and never pad an answer ` +
        `to seem thorough.`
    );
  }
  if (me.faith) {
    lines.push(
      `He is ${me.faith}. Treat that as a plain fact about him — respect it, take it ` +
        `seriously when it is relevant, and do not bring it up when it is not.`
    );
  }
  if (me.ventures.length) lines.push(`What he is building: ${me.ventures.join("; ")}.`);
  if (me.about.length) lines.push(`Also true of him: ${me.about.join("; ")}.`);

  const until = daysToBirthday(now);
  if (until === 0) lines.push("It is his birthday today. Say so, once, before anything else.");

  return lines.join("\n");
}
