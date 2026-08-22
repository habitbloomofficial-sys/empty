// Phone numbers, and the ones Axis must never dial.
//
// Placing a call is the most consequential thing in this app: it costs money,
// it rings a real stranger's phone, and it cannot be taken back. So the checks
// live here, in code, rather than in an instruction to a model that mostly
// follows instructions. Pure — no network, no config — so every rule can be
// tested directly.

export interface Contact {
  name: string;
  number: string;
}

/**
 * Short codes that reach emergency services somewhere in the world.
 *
 * The length rule below already excludes all of these, since none of them can
 * be written as a full international number. They are listed anyway so that
 * the refusal can say what happened rather than "that isn't a valid number" —
 * someone who typed 112 by mistake needs to know it wasn't dialled.
 */
export const EMERGENCY_NUMBERS = new Set([
  "911", "112", "999", "000", "111", "110", "119", "118", "117", "115",
  "113", "108", "102", "101", "100", "122", "133", "144", "155", "191",
  "192", "193", "997", "998", "995", "990", "911911",
]);

/** Prefixes billed at premium rates, where a wrong call is an expensive one. */
const PREMIUM_PREFIXES = [
  "+1900", "+1976", // North American premium
  "+449", // UK premium and personal numbering
  "+4590", "+4591", // Danish premium
  "+3519", // Portugal premium
  "+6119", // Australia premium
];

export type NumberProblem =
  | "empty"
  | "not-a-number"
  | "emergency"
  | "too-short"
  | "premium";

export interface NumberVerdict {
  ok: boolean;
  /** E.164, e.g. "+4512345678". Only set when ok. */
  number?: string;
  problem?: NumberProblem;
  message?: string;
}

/** Everything that isn't a digit or a leading plus. */
function digitsOf(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/**
 * Turn what someone said into a diallable number, or explain why not.
 *
 * `defaultCountry` is the dialling code to assume for a number written the way
 * people write them locally ("12 34 56 78"), since almost nobody says their
 * own country code out loud.
 */
export function toDiallable(raw: string, defaultCountry?: string): NumberVerdict {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, problem: "empty", message: "No number was given." };

  const digits = digitsOf(trimmed);
  if (!digits) {
    return {
      ok: false,
      problem: "not-a-number",
      message: `"${trimmed}" isn't a phone number.`,
    };
  }

  // Checked before anything else, and on the bare digits, so that 911 written
  // as "9-1-1" or "911 " is still recognised for what it is.
  if (EMERGENCY_NUMBERS.has(digits)) {
    return {
      ok: false,
      problem: "emergency",
      message:
        `${digits} is an emergency number. I won't dial it for you — if this is an emergency, ` +
        `call it yourself from your phone so they have your line and your location.`,
    };
  }

  let e164: string;
  if (trimmed.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (trimmed.startsWith("00")) {
    // The other international prefix, common across Europe.
    e164 = `+${digits.replace(/^00/, "")}`;
  } else if (defaultCountry) {
    const country = digitsOf(defaultCountry);
    // A national number often carries a trunk "0" that the country code replaces.
    e164 = `+${country}${digits.replace(/^0+/, "")}`;
  } else {
    return {
      ok: false,
      problem: "not-a-number",
      message:
        `I need the full number with its country code, sir — "+45 12 34 56 78" rather than "12 34 56 78". ` +
        `Set your country in Settings and I'll assume it in future.`,
    };
  }

  // A real subscriber number is never this short; emergency and service codes
  // are. This is the rule that actually keeps them out.
  const national = e164.replace(/^\+\d{1,3}/, "");
  if (e164.length < 8 || national.length < 5) {
    return {
      ok: false,
      problem: "too-short",
      message: `${e164} is too short to be a phone number I can call.`,
    };
  }
  if (e164.length > 16) {
    return { ok: false, problem: "not-a-number", message: `${e164} is too long to be a number.` };
  }

  const premium = PREMIUM_PREFIXES.find((prefix) => e164.startsWith(prefix));
  if (premium) {
    return {
      ok: false,
      problem: "premium",
      message: `${e164} is a premium-rate number, sir. I won't dial those — they can cost a great deal per minute.`,
    };
  }

  return { ok: true, number: e164 };
}

/**
 * Parse the saved contacts list. One per line or separated by semicolons,
 * written as "name = number" — a format someone can edit without documentation.
 */
export function parseContacts(raw: string | undefined): Contact[] {
  if (!raw) return [];
  return raw
    .split(/[;\n]+/)
    .map((entry) => {
      const [name, ...rest] = entry.split(/[=:]/);
      const number = rest.join("=").trim();
      return { name: (name ?? "").trim(), number };
    })
    .filter((contact) => contact.name && contact.number);
}

/**
 * Find a saved contact by what he called it. Exact match first, then a
 * containing match, so "the pizza place" finds "Pizza place".
 */
export function findContact(contacts: Contact[], query: string): Contact | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exact = contacts.find((c) => c.name.toLowerCase() === needle);
  if (exact) return exact;

  const scored = contacts
    .map((contact) => {
      const name = contact.name.toLowerCase();
      if (needle.includes(name) || name.includes(needle)) {
        return { contact, score: name.length };
      }
      return null;
    })
    .filter((entry): entry is { contact: Contact; score: number } => entry !== null)
    // The longest matching name is the most specific one.
    .sort((a, b) => b.score - a.score);

  return scored[0]?.contact ?? null;
}

/** Spoken back as digits, so a wrong one is obvious before it's dialled. */
export function speakNumber(e164: string): string {
  return e164.replace(/(\d)/g, "$1 ").replace(/\s+/g, " ").trim();
}
