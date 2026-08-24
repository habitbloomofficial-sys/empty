import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";

// The lock on the front door.
//
// It exists for one reason: the moment Axis is reachable from the internet, an
// unlocked Axis is a stranger's remote control for your computer, your inbox
// and your phone bill. So reaching him from outside your own network requires a
// passcode, and there is no way to turn that off — the setting is *what* the
// passcode is, not *whether* there is one.
//
// The passcode is never stored. What is stored is a scrypt hash of it, with a
// random salt, in a file of its own rather than in settings.json — so it never
// travels to the browser with the rest of the settings, not even masked.

const AUTH_PATH = path.join(process.cwd(), "data", "auth.json");

/** Deliberately slow, so guessing at it is expensive. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** How long a phone stays signed in. Long, because retyping it is the thing
 *  that makes people pick a short passcode. */
export const SESSION_DAYS = 30;

interface AuthFile {
  salt: string;
  hash: string;
  /** Signs session tokens. Rotating it signs everyone out. */
  secret: string;
  updatedAt: number;
}

function read(): AuthFile | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(AUTH_PATH, "utf-8"));
    const file = parsed as AuthFile;
    if (!file?.salt || !file?.hash || !file?.secret) return null;
    return file;
  } catch {
    return null;
  }
}

export function isPasscodeSet(): boolean {
  return read() !== null;
}

export function passcodeSetAt(): number | null {
  return read()?.updatedAt ?? null;
}

function derive(passcode: string, salt: string): string {
  return crypto
    .scryptSync(passcode.normalize("NFKC"), salt, SCRYPT.keylen, {
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      // The default cap is below what these parameters need.
      maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
    })
    .toString("hex");
}

/** Four digits is a phone lock screen; six is the floor for something on the
 *  open internet, where nobody is standing next to the door. */
export const MIN_LENGTH = 6;

export function setPasscode(passcode: string): void {
  const trimmed = passcode.trim();
  if (trimmed.length < MIN_LENGTH) {
    throw new Error(`A passcode needs at least ${MIN_LENGTH} characters, sir.`);
  }
  if (trimmed.length > 200) {
    throw new Error("That passcode is longer than anything useful, sir.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const file: AuthFile = {
    salt,
    hash: derive(trimmed, salt),
    // A new secret every time the passcode changes, so changing it signs out
    // every device that knew the old one. That is the point of changing it.
    secret: crypto.randomBytes(32).toString("hex"),
    updatedAt: Date.now(),
  };
  writeFileAtomic(AUTH_PATH, JSON.stringify(file, null, 2), 0o600);
}

export function clearPasscode(): void {
  try {
    fs.rmSync(AUTH_PATH, { force: true });
  } catch {
    // Nothing to clear is the same outcome as having cleared it.
  }
}

/** Constant-time, so the failures don't leak how close a guess was. */
export function checkPasscode(passcode: string): boolean {
  const file = read();
  if (!file) return false;

  const attempt = Buffer.from(derive(passcode.trim(), file.salt), "hex");
  const stored = Buffer.from(file.hash, "hex");
  if (attempt.length !== stored.length) return false;
  return crypto.timingSafeEqual(attempt, stored);
}

// --- sessions --------------------------------------------------------------

export const COOKIE_NAME = "axis_key";

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** A token is its own expiry plus a signature over it. No server-side list to
 *  keep, and nothing in it worth stealing on its own. */
export function issueToken(now = Date.now()): string {
  const file = read();
  if (!file) throw new Error("No passcode is set, sir.");
  const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${sign(expires, file.secret)}`;
}

export function isValidToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const file = read();
  if (!file) return false;

  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;

  const expected = Buffer.from(sign(expires, file.secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

// --- guessing --------------------------------------------------------------

// In memory, per process. Someone with a list of passcodes to try gets a few
// goes a minute rather than thousands, and a restart of Axis is not something
// an attacker can cause.
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function throttle(key: string, now = Date.now()): { allowed: boolean; waitMs: number } {
  const record = attempts.get(key);
  if (!record || record.until < now) {
    attempts.set(key, { count: 0, until: now + WINDOW_MS });
    return { allowed: true, waitMs: 0 };
  }
  if (record.count >= MAX_ATTEMPTS) {
    return { allowed: false, waitMs: record.until - now };
  }
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
