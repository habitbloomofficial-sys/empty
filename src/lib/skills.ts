import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";

// Knowing a job, and remembering THIS job.
//
// Two different things live here, on purpose.
//
// A BRIEF is what someone competent in a field already knows before anyone
// speaks: the handful of things that decide whether advice in that field is
// any good. Written down once, shipped in the code, the same on every machine.
// This is the difference between an assistant that can talk about marketing
// and one that knows a hook is the only part of an ad most people ever see.
//
// NOTES are what he has said about HIS work in that field — his supplier, his
// margins, the joke about the kick drum, the thing that went wrong in June.
// Those live in data/ because they are his, and they are filed BY FIELD so
// that asking about music production does not drag up his shipping times.
//
// Filing by field rather than one long list is the whole point. A single pile
// of remembered facts gets less useful as it grows, because every answer has
// to wade through all of it. A pile per job gets MORE useful as it grows.

const STORE = path.join(process.cwd(), "data", "skills.json");

export interface SkillBrief {
  /** The canonical name of the field. */
  niche: string;
  /** What he might call it. */
  aliases: string[];
  /** One line on what this covers. */
  scope: string;
  /**
   * The things a good practitioner knows that a general answer misses. These
   * are loaded into the prompt when the conversation is about this field, so
   * every line has to earn its place — no platitudes, nothing that could be
   * said of any field.
   */
  knows: string[];
}

/**
 * The fields he actually works in, plus the one he wants to learn.
 *
 * Each of these is opinionated on purpose. "Test different creatives" is not
 * knowledge, it is filler; "the hook is the first two seconds and nearly all
 * of your result is decided there" is knowledge, because it tells you what to
 * spend the afternoon on.
 */
export const BRIEFS: SkillBrief[] = [
  {
    niche: "dropshipping",
    aliases: ["shopify", "ecommerce", "e-commerce", "store", "shop", "online store", "drop shipping"],
    scope: "Running a Shopify store that sells products a supplier ships.",
    knows: [
      "One product carries the store. A shop of forty average products sells less than a shop built around one thing worth filming, because the advertising is where the work is and it cannot be split forty ways.",
      "The maths that decides everything: selling price minus product cost minus shipping minus the cost of getting one customer. If the cost of getting a customer is not known, nothing else in the plan is knowable either — it is the number to find first and the one beginners skip.",
      "Shipping time kills more stores than product choice. Three to four weeks from overseas produces refund requests and chargebacks that arrive AFTER the ad money is spent.",
      "A chargeback is worse than a refund: the money goes back, a fee is added, and enough of them close the payment account entirely.",
      "Payment processors and Shopify require the account holder to be a legal adult. For anyone under 18 the account has to be in a parent or guardian's name, with their knowledge — this is not optional and not a technicality; it is the thing that gets stores shut down and money frozen.",
      "Organic short video costs nothing but time and is the realistic route when the ad budget is small. It is also the one that teaches the most about what people actually respond to.",
      "Margins under about 3x the landed cost leave nothing to pay for advertising, returns and mistakes.",
    ],
  },
  {
    niche: "marketing",
    aliases: ["ads", "advertising", "copywriting", "copy", "branding", "social media", "content"],
    scope: "Getting attention and turning it into a sale.",
    knows: [
      "The hook is the first two seconds, and most of the result is decided there. Everything after it is only read by people the hook already caught.",
      "Write to one person about one problem. Copy addressed to everybody persuades nobody.",
      "Specific beats clever. A number, a name, a date — they are believed in a way adjectives are not.",
      "Features say what a thing is; benefits say what changes for the person. People buy the change.",
      "Objections do not go away because they are unmentioned. Naming the obvious one and answering it converts better than avoiding it.",
      "Judge an ad on cost per sale, not on likes. A video with a million views and no sales is entertainment.",
      "Creative beats targeting. When something is not working it is nearly always the hook, not the audience settings.",
    ],
  },
  {
    niche: "music production",
    aliases: ["music", "beats", "producing", "mixing", "mastering", "daw", "fl studio", "ableton"],
    scope: "Making and mixing tracks.",
    knows: [
      "Arrangement fixes more than mixing does. If a section is boring, no amount of EQ rescues it — something has to enter or leave.",
      "Most mixing is subtraction. Cutting what clashes beats boosting what should stand out, because boosting everything is the same as boosting nothing.",
      "Kick and bass fight over the same space. Deciding which one owns the low end — and carving the other out of it — is most of what makes a mix sound professional.",
      "Reference a finished track you admire, matched for loudness. Ears adjust to whatever they have been hearing for an hour and stop being trustworthy.",
      "Gain staging first: if everything is clipping into the master, nothing downstream behaves the way the plugin says it will.",
      "Loudness is not quality. A track crushed to be loud loses the punch that made it hit.",
      "Finish things. An unfinished folder of ideas teaches far less than one track taken all the way to the end, because only the end contains the hard parts.",
    ],
  },
  {
    niche: "engineering",
    aliases: ["technical engineering", "mechanical", "design", "cad", "3d printing", "3d printed", "structures", "physics"],
    scope: "Designing parts that carry load, and understanding why they hold.",
    knows: [
      "A beam's strength goes as the SQUARE of its depth in the direction it bends, and only linearly with width. Making a bracket twice as deep is four times as strong; twice as wide is only twice.",
      "Things break where the stress is highest, which is not always where they are thinnest — it is where the bending moment divided by the section modulus peaks. A thick part with a long lever can fail before a thin one with a short lever.",
      "A sharp internal corner concentrates stress and is where cracks start. A fillet is close to free and is often worth more than extra material.",
      "A printed part is a stack of welded layers, and the weld is about half the strength of the plastic. Which way up it prints changes the answer by up to a factor of two — for free.",
      "Safety factor is the margin between what a thing takes and what it is asked to take. Under about 2 for something above someone's head is not a design, it is a hope.",
      "Stiffness and strength are different properties. Something can be far too bendy long before it is anywhere near breaking — and for a shelf, bendy IS the failure.",
      "A slender column buckles long before it crushes, and buckling is sudden and total. Width and length decide it, not material strength.",
      "Shock doubles the load, roughly. Something caught or swung rather than set down gently is a different calculation.",
    ],
  },
  {
    niche: "faith",
    aliases: ["christian", "christianity", "church", "bible", "god", "prayer"],
    scope: "His faith, when he raises it.",
    knows: [
      "He is Christian. When he brings it up, engage with it seriously and on its own terms rather than hedging into neutrality.",
      "Do not preach at him, and do not bring it up unprompted in an answer about something else.",
      "He may want to think about whether a business decision sits right with him. That is a real question and worth taking seriously rather than deflecting to 'that's personal'.",
    ],
  },
  {
    niche: "school",
    aliases: ["homework", "exam", "revision", "test", "study", "maths", "math", "science"],
    scope: "Schoolwork and exams.",
    knows: [
      "Give the answer, then the rule that produces it, then the trap the question was built around.",
      "Show every step when working is shown. A leap from line two to the answer teaches nothing.",
      "When he has it wrong, say WHERE — which line, which sign — not that the whole thing is wrong.",
    ],
  },
];

// --- what HE has said about his own work in each field ----------------------

export interface SkillNotes {
  niche: string;
  /** Things he has told Jarvis about his work in this field. */
  notes: string[];
  /** Jokes, names and running references that belong to this field. */
  jokes: string[];
  updatedAt: number;
}

type Store = Record<string, SkillNotes>;

function read(): Store {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [niche, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<SkillNotes>;
      out[niche] = {
        niche,
        notes: Array.isArray(entry.notes) ? entry.notes.filter((n) => typeof n === "string") : [],
        jokes: Array.isArray(entry.jokes) ? entry.jokes.filter((n) => typeof n === "string") : [],
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  writeFileAtomic(STORE, JSON.stringify(store, null, 2));
}

/**
 * Which field he means, however he said it.
 *
 * Unknown names are ALLOWED through as their own field rather than refused.
 * He will work in things this file has never heard of, and "I don't have a
 * category for that" is a worse answer than quietly making one.
 */
export function resolveNiche(spoken: string): string {
  const wanted = spoken.trim().toLowerCase();
  if (!wanted) throw new Error("Which kind of work, sir?");

  const brief = BRIEFS.find(
    (entry) => entry.niche === wanted || entry.aliases.includes(wanted)
  );
  if (brief) return brief.niche;

  // Then a looser look, so "shopify store" finds "shopify".
  const loose = BRIEFS.find(
    (entry) =>
      wanted.includes(entry.niche) || entry.aliases.some((alias) => wanted.includes(alias))
  );
  return loose ? loose.niche : wanted.replace(/\s+/g, " ");
}

export function briefFor(niche: string): SkillBrief | null {
  return BRIEFS.find((entry) => entry.niche === niche) ?? null;
}

export function notesFor(niche: string): SkillNotes {
  return read()[niche] ?? { niche, notes: [], jokes: [], updatedAt: 0 };
}

export function listNiches(): { niche: string; notes: number; jokes: number; builtIn: boolean }[] {
  const store = read();
  const names = new Set([...BRIEFS.map((b) => b.niche), ...Object.keys(store)]);
  return [...names]
    .map((niche) => ({
      niche,
      notes: store[niche]?.notes.length ?? 0,
      jokes: store[niche]?.jokes.length ?? 0,
      builtIn: BRIEFS.some((b) => b.niche === niche),
    }))
    .sort((a, b) => a.niche.localeCompare(b.niche));
}

export function rememberForNiche(
  spokenNiche: string,
  text: string,
  kind: "note" | "joke" = "note"
): SkillNotes {
  const tidy = text.trim();
  if (!tidy) throw new Error("There's nothing there to remember, sir.");

  const niche = resolveNiche(spokenNiche);
  const store = read();
  const entry = store[niche] ?? { niche, notes: [], jokes: [], updatedAt: 0 };
  const list = kind === "joke" ? entry.jokes : entry.notes;

  if (!list.some((existing) => existing.toLowerCase() === tidy.toLowerCase())) list.push(tidy);
  entry.updatedAt = Date.now();
  store[niche] = entry;
  write(store);
  return entry;
}

export function forgetForNiche(spokenNiche: string, text: string): boolean {
  const niche = resolveNiche(spokenNiche);
  const store = read();
  const entry = store[niche];
  if (!entry) return false;

  const wanted = text.trim().toLowerCase();
  const before = entry.notes.length + entry.jokes.length;
  entry.notes = entry.notes.filter((n) => !n.toLowerCase().includes(wanted));
  entry.jokes = entry.jokes.filter((n) => !n.toLowerCase().includes(wanted));
  if (entry.notes.length + entry.jokes.length === before) return false;

  entry.updatedAt = Date.now();
  store[niche] = entry;
  write(store);
  return true;
}

/**
 * Everything worth knowing for this field, as one block for the prompt.
 *
 * His own notes come LAST and are labelled as his, because when what he has
 * said conflicts with the general brief, what he has said wins — he knows his
 * supplier's shipping times and this file does not.
 */
export function skillContext(spokenNiche: string): string | null {
  const niche = resolveNiche(spokenNiche);
  const brief = briefFor(niche);
  const mine = notesFor(niche);
  if (!brief && mine.notes.length === 0 && mine.jokes.length === 0) return null;

  const parts: string[] = [];
  if (brief) {
    parts.push(`${brief.niche} — ${brief.scope}`);
    parts.push(brief.knows.map((line) => `- ${line}`).join("\n"));
  }
  if (mine.notes.length) {
    parts.push(`What HE has told you about his own ${niche} work (this wins over the above):`);
    parts.push(mine.notes.map((line) => `- ${line}`).join("\n"));
  }
  if (mine.jokes.length) {
    parts.push(`Running jokes and references in ${niche}:`);
    parts.push(mine.jokes.map((line) => `- ${line}`).join("\n"));
  }
  return parts.join("\n");
}
