// Asking before spending his money.
//
// Axis can do two things that cost real money per go: make a video, and make a
// thumbnail. He has always been *told* to warn first, in the prompt. A prompt
// is an instruction, and an instruction is something a model can forget on the
// one turn where it matters — the turn that costs three dollars.
//
// So the warning is not an instruction here. It is a gate: a paid action
// refuses to run unless a quote for that exact request was issued first and is
// still fresh. Calling it the first time cannot spend anything, whatever the
// model passes in, because there is nothing to confirm against yet. The second
// call, after he has said yes, finds the quote and goes ahead.
//
// The quote is keyed on what was asked for, so agreeing to a thumbnail of a
// chess board does not silently authorise a different one.

import crypto from "node:crypto";

export interface Quote {
  /** What is about to happen, in his words. */
  action: string;
  /** The specific request, so a yes applies to this and nothing else. */
  detail: string;
  low: number;
  high: number;
  currency: string;
  at: number;
}

/**
 * How long a yes stays good for.
 *
 * Long enough to read the question, think, and answer. Short enough that a yes
 * from this morning cannot authorise a charge this afternoon.
 */
const QUOTE_TTL_MS = 10 * 60 * 1000;

// Process lifetime only. A restart forgets every pending quote, which is the
// safe direction to fail in: the worst it costs is being asked again.
const pending = new Map<string, Quote>();

function fingerprint(action: string, detail: string): string {
  return crypto
    .createHash("sha256")
    .update(`${action} ${detail.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .digest("hex");
}

function sweep(now: number): void {
  for (const [key, quote] of pending) {
    if (now - quote.at > QUOTE_TTL_MS) pending.delete(key);
  }
}

/** Money, the way a person says it. */
export function describePrice(low: number, high: number, currency = "$"): string {
  const round = (n: number) =>
    n < 1 ? n.toFixed(2).replace(/0$/, "") : String(Math.round(n * 100) / 100);
  return low === high
    ? `${currency}${round(low)}`
    : `${currency}${round(low)} to ${currency}${round(high)}`;
}

export interface Asked {
  quoted: true;
  question: string;
  price: string;
  low: number;
  high: number;
}

/**
 * Put the price to him, and remember that it was put.
 *
 * Returns the question to ask. Nothing is spent, and nothing can be, until the
 * matching confirmation comes back.
 */
export function askFirst(
  action: string,
  detail: string,
  low: number,
  high: number,
  currency = "$",
  now = Date.now()
): Asked {
  sweep(now);
  const quote: Quote = { action, detail, low, high, currency, at: now };
  pending.set(fingerprint(action, detail), quote);

  const price = describePrice(low, high, currency);
  return {
    quoted: true,
    question: `That will cost about ${price}, sir. Shall I go ahead?`,
    price,
    low,
    high,
  };
}

/**
 * Whether this exact request has been agreed to, consuming the agreement.
 *
 * Consumed rather than kept, so one yes buys one thing. Asking for the same
 * thumbnail twice asks twice, which is the behaviour anyone would expect of
 * someone spending their money.
 */
export function takeApproval(action: string, detail: string, now = Date.now()): Quote | null {
  sweep(now);
  const key = fingerprint(action, detail);
  const quote = pending.get(key);
  if (!quote) return null;
  pending.delete(key);
  return quote;
}

/** For tests, and for anything that wants to show what is outstanding. */
export function pendingQuotes(now = Date.now()): Quote[] {
  sweep(now);
  return [...pending.values()];
}

/** Forget everything outstanding — used when he says never mind. */
export function clearQuotes(): void {
  pending.clear();
}
