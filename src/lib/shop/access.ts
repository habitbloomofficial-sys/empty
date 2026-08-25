import crypto from "node:crypto";

/*
 * The door to the trade portal.
 *
 * A wholesale catalogue is priced for resellers, not for the public — trade
 * prices next to recommended retail prices are exactly the sheet you don't want
 * a retail customer, or a competitor, reading. So the whole shop sits behind an
 * access code the client hands out to approved accounts.
 *
 * The check happens on the server and the answer comes back as a signed cookie.
 * That matters: if the code lived in the bundle, "anything else is rejected"
 * would be a suggestion — anyone could read the right answer out of the
 * JavaScript, or skip the gate entirely and call the page directly.
 */

/** The code itself. Overridable, so the client can change it without a deploy. */
export const ACCESS_CODE = process.env.SHOP_ACCESS_CODE?.trim() || "camilla";

export const COOKIE_NAME = "aurea_trade";

/** How long an approved buyer stays signed in. */
export const SESSION_HOURS = 12;

/**
 * Signs session cookies.
 *
 * A generated fallback keeps a fresh install working with no configuration, at
 * the cost of signing everyone out when the server restarts. Set
 * SHOP_SESSION_SECRET in production and sessions survive a deploy — and if the
 * portal is ever run behind more than one server process, that variable stops
 * being optional, because two processes would otherwise mint tokens neither
 * would accept from the other.
 *
 * The fallback is parked on globalThis rather than in a module constant on
 * purpose. This module is imported both by route handlers and by the page's
 * server component, and the framework gives those two separate module
 * instances — so a plain `const` here would generate two different secrets in
 * one process, and the cookie written by the sign-in route would be rejected
 * by the page that reads it a moment later.
 */
const SECRET_KEY = Symbol.for("aurea.session.secret");
type SecretHolder = { [SECRET_KEY]?: string };

function secret(): string {
  const configured = process.env.SHOP_SESSION_SECRET;
  if (configured) return configured;

  const holder = globalThis as SecretHolder;
  holder[SECRET_KEY] ??= crypto.randomBytes(32).toString("hex");
  return holder[SECRET_KEY];
}

/** Case and stray spaces shouldn't decide whether a buyer gets in. */
function normalise(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase();
}

/** Constant-time, so a wrong code can't be narrowed down by how long it took. */
export function checkCode(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const given = Buffer.from(normalise(input));
  const expected = Buffer.from(normalise(ACCESS_CODE));
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** The token is its own expiry plus a signature over it — no session table. */
export function issueToken(now = Date.now()): string {
  const expires = String(now + SESSION_HOURS * 60 * 60 * 1000);
  return `${expires}.${sign(expires)}`;
}

export function isValidToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;

  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

// --- guessing --------------------------------------------------------------

// In memory, per process, per address. Enough to turn a dictionary attack into
// a handful of guesses a quarter of an hour, without a database behind it.
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function throttle(key: string, now = Date.now()): { allowed: boolean; waitMs: number } {
  const record = attempts.get(key);
  if (!record || record.until < now) {
    attempts.set(key, { count: 0, until: now + WINDOW_MS });
    return { allowed: true, waitMs: 0 };
  }
  if (record.count >= MAX_ATTEMPTS) return { allowed: false, waitMs: record.until - now };
  return { allowed: true, waitMs: 0 };
}

export function recordFailure(key: string, now = Date.now()): void {
  const record = attempts.get(key) ?? { count: 0, until: now + WINDOW_MS };
  record.count += 1;
  attempts.set(key, record);
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Attempts left before the lockout, for the counter under the code field. */
export function attemptsLeft(key: string, now = Date.now()): number {
  const record = attempts.get(key);
  if (!record || record.until < now) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - record.count);
}
