import { getSetting } from "./settings";
import type { ListeningMode } from "./addressed";

// Two settings that decide how forward he is, kept together because they are
// the same question asked twice: how much may he do without being told to.

/**
 * How hard his name is required.
 *
 * "smart" is the default because requiring the name before every sentence is
 * the single most irritating thing about talking to an assistant, and the
 * judgement in addressed.ts is good enough to carry it. "name" is there for
 * anyone who wants the old behaviour back, and for a noisy room.
 */
export function listeningMode(): ListeningMode {
  const set = getSetting("LISTENING_MODE")?.trim().toLowerCase();
  if (set === "name" || set === "smart" || set === "open") return set;
  return "smart";
}

/**
 * Whether he may act on his own.
 *
 * Off unless asked for. Something that opens a browser tab unbidden is
 * delightful when it is right and infuriating when it is wrong, and that is
 * not a judgement to make on someone's behalf by default.
 */
export function hasInitiative(): boolean {
  return (getSetting("INITIATIVE") ?? "off").toLowerCase() === "on";
}
