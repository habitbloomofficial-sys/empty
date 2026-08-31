import type { DeviceKind } from "./device";
import { availableCapabilities, type Capability } from "./offers";
import type { IntegrationStatus } from "./types";

// What he says when you arrive, and it depends on where you are standing.
//
// Opening Axis on a phone on a train is not the same event as opening him at
// the desk, and greeting both the same way is the tell that nothing is really
// paying attention. On a phone he says so, and what he offers is shaped by the
// fact that you are away from the machine: your inbox, a look at what is on the
// computer, something found and sent to you — not "shall I open Spotify",
// which would start playing music in an empty room at home.
//
// Same two rules as offers.ts, for the same reasons. He only says a line whose
// capability is actually switched on, and he remembers the last several so the
// rotation does not double back on itself.

export interface Greeting {
  line: string;
  needs: Capability;
  /**
   * True when the line already ends in an offer.
   *
   * The caller adds a separate offer to a bare greeting; adding one to a line
   * that has already asked something makes two questions in a row, which is an
   * interview rather than a hello.
   */
  asks: boolean;
}

/**
 * The boot greeting: what a butler says when you walk in.
 *
 * The time of day and the real count of what he is holding, because "all
 * present and accounted for" is only worth saying if it is actually a report.
 * A made-up number here would be the exact opposite of the point.
 */
export function bootGreeting(
  status: IntegrationStatus | null,
  now: Date = new Date(),
  title = "sir"
): string {
  const hour = now.getHours();
  const partOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const held = status?.memories ?? 0;
  const learned = status?.learned ?? 0;
  const total = held + learned;

  // Nothing remembered yet is a different sentence. Reporting "0 things
  // indexed, all present and accounted for" is a joke he did not ask for.
  if (total === 0) {
    return `${partOfDay}, ${title}. Nothing in the ledger yet — I shall start keeping notes.`;
  }
  return `${partOfDay}, ${title}. ${total.toLocaleString()} ${
    total === 1 ? "thing" : "things"
  } remembered, all present and accounted for.`;
}

/** At the desk. He has no reason to remark on where you are. */
const AT_THE_DESK: Greeting[] = [
  { line: "Hey, sir. Welcome back.", needs: "always", asks: false },
  {
    line: "All operations are up and running. Is there anything you would like to change, sir?",
    needs: "always",
    asks: true,
  },
  { line: "Good to see you, sir. Everything's where you left it.", needs: "always", asks: false },
  { line: "At your service, sir.", needs: "always", asks: false },
  { line: "Back at it, sir? I'm listening.", needs: "always", asks: false },
  { line: "Systems are yours, sir.", needs: "always", asks: false },
  { line: "Evening, sir — or whatever it is where you are. What are we doing?", needs: "always", asks: true },
  { line: "Ready when you are, sir.", needs: "always", asks: false },
];

/**
 * On the phone. He notices, and offers something that makes sense away from
 * the desk.
 *
 * These are written to be heard rather than read — short, one thought, and the
 * offer is the kind of thing you can act on with one hand on a train.
 */
const ON_THE_MOVE: Greeting[] = [
  {
    line: "I see you're on your phone, sir. Is there anything I can do for you while you're on the run?",
    needs: "always",
    asks: true,
  },
  {
    line: "You're on your phone, sir — anything you need while you're out?",
    needs: "always",
    asks: true,
  },
  {
    line: "Hey, sir. On the move, I see. Say the word and I'll get on with something.",
    needs: "always",
    asks: true,
  },
  {
    line: "Phone today, sir. I'm still connected to the computer if you need anything from it.",
    needs: "always",
    asks: false,
  },
  {
    line: "Out and about, sir? I'm here.",
    needs: "always",
    asks: false,
  },
  {
    line: "I see you're away from the desk, sir. Want me to catch you up on anything?",
    needs: "always",
    asks: true,
  },
  {
    line: "Travelling, sir? Anything you want me to have ready by the time you're back.",
    needs: "always",
    asks: true,
  },
  {
    line: "I see you're on your phone, sir. Shall I give you an update on your email?",
    needs: "gmail",
    asks: true,
  },
  {
    line: "On your phone, sir — want the headlines from your inbox?",
    needs: "gmail",
    asks: true,
  },
  {
    line: "Away from the desk, sir? I can read you anything that's come in.",
    needs: "gmail",
    asks: true,
  },
  {
    line: "I see you're out, sir. Anything on the calendar you'd like reminding of?",
    needs: "calendar",
    asks: true,
  },
  {
    line: "On the move, sir. Say the word and I'll check what's on the computer for you.",
    needs: "files",
    asks: true,
  },
  {
    line: "You're on your phone, sir — I can go through the folders here and find something if you need it.",
    needs: "files",
    asks: true,
  },
  {
    line: "Out and about, sir? I can look something up for you while you walk.",
    needs: "web",
    asks: true,
  },
  {
    line: "I see you're on your phone, sir. Want me to message anyone for you?",
    needs: "whatsapp",
    asks: true,
  },
];

/** A tablet is a phone with room to read. Mostly the same, worded for a sofa. */
const ON_A_TABLET: Greeting[] = [
  { line: "I see you're on your tablet, sir. What can I do for you?", needs: "always", asks: true },
  { line: "Tablet today, sir. I'm still hooked up to the computer.", needs: "always", asks: false },
  { line: "Hey, sir. Comfortable? Tell me what you need.", needs: "always", asks: true },
  { line: "On the tablet, sir — shall I run through your email?", needs: "gmail", asks: true },
  { line: "Away from the desk, sir? I can find anything on the computer for you.", needs: "files", asks: true },
];

const STORAGE_KEY = "axis:recentGreetings";
/** Enough that a day of opening and closing him never repeats. */
const REMEMBER = 6;

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

export function greetingsFor(kind: DeviceKind): Greeting[] {
  if (kind === "phone") return ON_THE_MOVE;
  if (kind === "tablet") return ON_A_TABLET;
  return AT_THE_DESK;
}

/**
 * How he says hello this time.
 *
 * Chosen from the lines that suit the device he is being used from and the
 * things that are actually switched on, avoiding the last several. The device
 * defaults to the computer, so a greeting still comes out if the status call
 * has not landed yet — being a moment late with "I see you're on your phone"
 * is worse than never saying it.
 */
export function nextGreeting(
  kind: DeviceKind = "computer",
  status: IntegrationStatus | null = null,
  random: () => number = Math.random
): Greeting {
  const live = availableCapabilities(status);
  const possible = greetingsFor(kind).filter((greeting) => live.has(greeting.needs));
  // Every list has "always" lines in it, so this cannot come back empty — but
  // if a future edit made it, saying nothing is worse than saying hello.
  if (possible.length === 0) return { line: "At your service, sir.", needs: "always", asks: false };

  const heard = new Set(recent());
  const fresh = possible.filter((greeting) => !heard.has(greeting.line));
  const pool = fresh.length > 0 ? fresh : possible;

  const chosen = pool[Math.floor(random() * pool.length) % pool.length];
  remember(chosen.line);
  return chosen;
}
