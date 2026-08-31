import type { IntegrationStatus } from "./types";

// Things Axis offers to do, unprompted, when you open him.
//
// He answers well and starts nothing, which makes him feel like a search box
// with a voice. A line like "need an essay in Word doing for tomorrow?" costs
// nothing and changes what he is: something that knows what it is for.
//
// Two rules hold this together.
//
// He only ever offers what he can actually do. Every line below names the
// capability it needs, and one whose capability is switched off is never
// chosen — offering to go through an inbox he cannot reach is worse than
// saying nothing, because it has to be followed by an apology.
//
// And he does not repeat himself. There are enough lines here that you can use
// him for weeks without hearing one twice, and the last several are remembered
// so the rotation never doubles back on itself.

/** What a line needs before he is allowed to say it. */
export type Capability =
  | "always"
  | "gmail"
  | "calendar"
  | "youtube"
  | "youtubeChannel"
  | "documents"
  | "desktop"
  | "web"
  | "whatsapp"
  | "phone"
  | "files";

export interface Offer {
  needs: Capability;
  line: string;
}

// Written to be spoken. Short, one thought each, and none of them ending in a
// question he has to think about — an offer, not an interview.
export const OFFERS: Offer[] = [
  // --- documents: essays, decks, spreadsheets ---
  { needs: "documents", line: "Need an essay written in Word for tomorrow?" },
  { needs: "documents", line: "Anything to invoice, sir? I'll do the VAT." },
  { needs: "documents", line: "Shall I check what's still outstanding?" },
  { needs: "documents", line: "Any bills come in that I should be keeping track of?" },
  { needs: "documents", line: "Want me to see who hasn't paid you yet?" },
  { needs: "documents", line: "Anything you'd like modelled and printed, sir?" },
  { needs: "documents", line: "Shall I work out whether that would actually hold the weight?" },
  { needs: "documents", line: "Shall I put a presentation together for you?" },
  { needs: "documents", line: "Any homework I can make a start on?" },
  { needs: "documents", line: "I could draft that report, if it's still hanging over you." },
  { needs: "documents", line: "Want a deck made? I'll do the colours and the charts." },
  { needs: "documents", line: "Anything that needs writing up before the deadline?" },
  { needs: "documents", line: "Shall I turn some notes into something you can hand in?" },
  { needs: "documents", line: "I can build a spreadsheet if there's a budget to sort out." },
  { needs: "documents", line: "Say the word and there's an outline waiting for you." },

  // --- his channel ---
  { needs: "youtubeChannel", line: "Shall I check how the channel's doing?" },
  { needs: "youtubeChannel", line: "Want to know how the last upload is performing?" },
  { needs: "youtubeChannel", line: "I can look at your subscriber count, if you're curious." },
  { needs: "youtubeChannel", line: "Shall I see what your competitors have been up to?" },
  { needs: "youtubeChannel", line: "Want me to find some channels worth watching in your niche?" },

  // --- youtube generally ---
  { needs: "youtube", line: "Any new videos you'd like to watch?" },
  { needs: "youtube", line: "Shall I pull something up on YouTube?" },
  { needs: "youtube", line: "Anything you've been meaning to catch up on?" },

  // --- email ---
  { needs: "gmail", line: "Want me to go through your inbox?" },
  { needs: "gmail", line: "Shall I see if anything's come in worth reading?" },
  { needs: "gmail", line: "Any emails you'd like drafted while you're here?" },
  { needs: "gmail", line: "I can clear out what's unread, if you'd rather not look." },
  { needs: "gmail", line: "Anyone you've been meaning to reply to?" },

  // --- calendar ---
  { needs: "calendar", line: "Shall I tell you what's on today?" },
  { needs: "calendar", line: "Anything to put in the diary?" },
  { needs: "calendar", line: "Want to know what's coming up this week?" },

  // --- the machine ---
  { needs: "desktop", line: "Shall I put some music on?" },
  { needs: "desktop", line: "Anything you'd like opened?" },
  { needs: "desktop", line: "Want a playlist on while you work?" },
  { needs: "desktop", line: "I can open whatever you were in the middle of." },

  // --- his folders ---
  { needs: "files", line: "Lost a file? I can find it faster than the search box will." },
  { needs: "files", line: "Want me to dig out what you were working on yesterday?" },

  // --- the web ---
  { needs: "web", line: "Anything you'd like looked up?" },
  { needs: "web", line: "Want me to check on anything out there?" },
  { needs: "web", line: "Something you've been wondering about? I can go and find out." },

  // --- messages and calls ---
  { needs: "whatsapp", line: "Any messages you'd like sent?" },
  { needs: "phone", line: "Anyone you need ringing?" },

  // --- always available, because thinking is always available ---
  { needs: "always", line: "Anything I can take off your hands?" },
  { needs: "always", line: "What are we working on?" },
  { needs: "always", line: "Something on your mind?" },
  { needs: "always", line: "Put me to work." },
  { needs: "always", line: "Anything you'd like a second opinion on?" },
  { needs: "always", line: "Where would you like to start?" },
];

/** Which capabilities are actually live, from what the server reports. */
export function availableCapabilities(status: IntegrationStatus | null): Set<Capability> {
  const live = new Set<Capability>(["always", "documents"]);
  if (!status) return live;

  if (status.gmail) live.add("gmail");
  if (status.calendar) live.add("calendar");
  if (status.youtube) live.add("youtube");
  if (status.youtube && status.youtubeChannel) live.add("youtubeChannel");
  if (status.desktopControl) live.add("desktop");
  if (status.desktopControl && status.fileRoots.length > 0) live.add("files");
  if (status.webSearch) live.add("web");
  if (status.whatsapp) live.add("whatsapp");
  if (status.phone) live.add("phone");
  return live;
}

const STORAGE_KEY = "axis:recentOffers";
/** How many to remember. Enough that a short session never hears a repeat. */
const REMEMBER = 12;

function recent(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(line: string): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([line, ...recent().filter((l) => l !== line)].slice(0, REMEMBER))
    );
  } catch {
    // Storage refused. He may repeat himself; nothing else breaks.
  }
}

/**
 * One thing he could do for you, or nothing.
 *
 * Nothing, most of the time: an assistant that asks you something every single
 * time you open him is a pop-up. `chance` is the proportion of openings that
 * carry an offer at all.
 */
export function pickOffer(
  status: IntegrationStatus | null,
  options: { chance?: number; random?: () => number } = {}
): string | null {
  const random = options.random ?? Math.random;
  const chance = options.chance ?? 0.55;
  if (random() >= chance) return null;

  const live = availableCapabilities(status);
  const possible = OFFERS.filter((offer) => live.has(offer.needs));
  if (possible.length === 0) return null;

  const heard = new Set(recent());
  // Anything not heard lately. If he has somehow heard everything, the whole
  // list comes back rather than nothing being said.
  const fresh = possible.filter((offer) => !heard.has(offer.line));
  const pool = fresh.length > 0 ? fresh : possible;

  const chosen = pool[Math.floor(random() * pool.length) % pool.length];
  remember(chosen.line);
  return chosen.line;
}
