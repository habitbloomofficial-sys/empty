import { getSetting } from "./settings";

// Zapier, through the door Zapier built for exactly this.
//
// A Zap that starts with "Webhooks by Zapier → Catch Hook" hands you a URL.
// Anything that POSTs to it starts the Zap. That is the whole integration: no
// key, no OAuth, no account linking, and it reaches every one of the thousands
// of apps Zapier connects to — because you built the Zap, Axis only pulls the
// trigger.
//
// The safety rule that matters: Axis fires a Zap **by name**, from a list you
// saved, and never by URL. A webhook URL is a loaded action with no
// confirmation step, so one arriving mid-conversation — in an email he read,
// on a page he opened — must never be something he can call.

export interface Zap {
  name: string;
  url: string;
}

/** Only Zapier's own hook host, and only over TLS. */
export function isZapierHook(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "hooks.zapier.com" || host.endsWith(".hooks.zapier.com");
  } catch {
    return false;
  }
}

/**
 * Parse the saved list. One per line, "name = url" — the same shape as the
 * phone contacts, so there is one format to learn rather than two.
 */
export function parseZaps(raw: string | undefined): Zap[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n+/)
    .map((line) => {
      const at = line.indexOf("=");
      if (at === -1) return null;
      const name = line.slice(0, at).trim();
      const url = line.slice(at + 1).trim();
      if (!name || !isZapierHook(url)) return null;
      return { name, url };
    })
    .filter((zap): zap is Zap => zap !== null);
}

export function savedZaps(): Zap[] {
  return parseZaps(getSetting("ZAPIER_HOOKS"));
}

export function isZapierConfigured(): boolean {
  return savedZaps().length > 0;
}

/** Find a Zap by what he called it — exact first, then a containing match. */
export function findZap(zaps: Zap[], query: string): Zap | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exact = zaps.find((zap) => zap.name.toLowerCase() === needle);
  if (exact) return exact;

  const partial = zaps
    .filter((zap) => {
      const name = zap.name.toLowerCase();
      return needle.includes(name) || name.includes(needle);
    })
    // The longest matching name is the most specific one.
    .sort((a, b) => b.name.length - a.name.length);

  return partial[0] ?? null;
}

export interface ZapResult {
  name: string;
  status: number;
  note: string;
}

const TIMEOUT_MS = 15_000;

/**
 * Fire a Zap.
 *
 * Zapier answers immediately and runs the Zap afterwards, so a success here
 * means "Zapier accepted it", not "the thing you wanted has happened". Said
 * plainly in the note, because the difference shows up the first time a Zap
 * fails silently at step three.
 */
export async function runZap(name: string, data?: Record<string, unknown>): Promise<ZapResult> {
  const zaps = savedZaps();
  if (zaps.length === 0) {
    throw new Error(
      "No Zaps are set up yet, sir — add one in Settings under the Tool Armory."
    );
  }

  const zap = findZap(zaps, name);
  if (!zap) {
    throw new Error(
      `I don't have a Zap called "${name}", sir. I have: ${zaps.map((z) => z.name).join(", ")}.`
    );
  }

  let res: Response;
  try {
    res = await fetch(zap.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "Axis",
        firedAt: new Date().toISOString(),
        ...(data ?? {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Zapier didn't answer in time, sir — the Zap may not have started.");
    }
    throw err;
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 410) {
      throw new Error(
        `Zapier says that hook no longer exists, sir. "${zap.name}" may have been turned off or deleted — check the Zap is on and re-copy its URL.`
      );
    }
    throw new Error(`Zapier refused that (HTTP ${res.status}), sir.`);
  }

  return {
    name: zap.name,
    status: res.status,
    note: `Zapier has accepted "${zap.name}" and is running it now. It reports back to Zapier rather than to me, so check there if you need to know it finished.`,
  };
}
