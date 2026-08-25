/*
 * Where the shop keeps things.
 *
 * Deliberately not the local disk. Carts and purchase orders belong in a cloud
 * store the client can reach from anywhere and back up — not in a folder on
 * whichever machine happened to run the server. So this module writes over HTTP
 * to a hosted key-value store and never touches the filesystem.
 *
 * Configure it with two environment variables and every write goes to the cloud:
 *
 *   KV_REST_API_URL    https://<name>.upstash.io
 *   KV_REST_API_TOKEN  <token>
 *
 * Those are the names Vercel KV and Upstash Redis both use, so a store created
 * through either is a copy-paste away. `SHOP_KV_URL` / `SHOP_KV_TOKEN` also
 * work if you'd rather keep the shop's store separate from anything else.
 *
 * With nothing configured the shop falls back to process memory so it still
 * runs out of the box — data lives for as long as the server does and is never
 * written to a file. `storageMode()` reports which of the two is in force, and
 * the portal says so on screen rather than letting anyone assume.
 */

const URL_BASE = (process.env.SHOP_KV_URL || process.env.KV_REST_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.SHOP_KV_TOKEN || process.env.KV_REST_API_TOKEN || "";

export type StorageMode = "cloud" | "memory";

export function storageMode(): StorageMode {
  return URL_BASE && TOKEN ? "cloud" : "memory";
}

/**
 * Fallback only. Never serialised to disk.
 *
 * On globalThis for the same reason the session secret is: route handlers and
 * server components are separate module instances, so a plain module-level Map
 * would give the page a different store from the one the API just wrote to.
 * A configured cloud store sidesteps the question entirely, which is rather
 * the point of configuring one.
 */
type Held = { value: string; expiresAt: number };
const MEMORY_KEY = Symbol.for("aurea.store.memory");
type MemoryHolder = { [MEMORY_KEY]?: Map<string, Held> };

const holder = globalThis as MemoryHolder;
holder[MEMORY_KEY] ??= new Map<string, Held>();
const memory = holder[MEMORY_KEY];

function sweep(now: number) {
  for (const [key, held] of memory) if (held.expiresAt <= now) memory.delete(key);
}

/** Default lifetime for anything the shop stores: long enough for a buying
 *  session to survive a closed laptop, short enough not to hoard. */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

async function command(parts: (string | number)[]): Promise<unknown> {
  const response = await fetch(URL_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts.map(String)),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Cloud store refused the request (${response.status}).`);
  }
  const body: unknown = await response.json();
  return (body as { result?: unknown })?.result ?? null;
}

export async function readValue(key: string): Promise<string | null> {
  if (storageMode() === "cloud") {
    const result = await command(["GET", key]);
    return typeof result === "string" ? result : null;
  }
  sweep(Date.now());
  return memory.get(key)?.value ?? null;
}

export async function writeValue(
  key: string,
  value: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  if (storageMode() === "cloud") {
    await command(["SET", key, value, "EX", ttlSeconds]);
    return;
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function deleteValue(key: string): Promise<void> {
  if (storageMode() === "cloud") {
    await command(["DEL", key]);
    return;
  }
  memory.delete(key);
}

/** Append to a capped list — used for a buyer's order history. */
export async function pushToList(key: string, value: string, keep = 50): Promise<void> {
  if (storageMode() === "cloud") {
    await command(["LPUSH", key, value]);
    await command(["LTRIM", key, 0, keep - 1]);
    await command(["EXPIRE", key, DEFAULT_TTL_SECONDS]);
    return;
  }
  const existing = memory.get(key)?.value;
  const list: string[] = existing ? (JSON.parse(existing) as string[]) : [];
  list.unshift(value);
  memory.set(key, {
    value: JSON.stringify(list.slice(0, keep)),
    expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
  });
}

export async function readList(key: string, keep = 50): Promise<string[]> {
  if (storageMode() === "cloud") {
    const result = await command(["LRANGE", key, 0, keep - 1]);
    return Array.isArray(result) ? (result as string[]) : [];
  }
  sweep(Date.now());
  const existing = memory.get(key)?.value;
  return existing ? (JSON.parse(existing) as string[]) : [];
}

/** Read JSON, returning null rather than throwing on anything unparseable. */
export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await readValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  await writeValue(key, JSON.stringify(value), ttlSeconds);
}
