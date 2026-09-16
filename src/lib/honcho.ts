import { getSetting } from "./settings";

// Memory that outlives this computer.
//
// Jarvis already remembers things — memory.ts keeps facts he has been told, and
// sessions.ts keeps a log of what happened. Both are files on one machine. Wipe
// Windows, or pick up your phone, and they are not there.
//
// Honcho is a service that holds a longer picture: you write the conversation
// to it, it reasons over what was said in the background, and later you can ask
// it what it has worked out. It is not a transcript — it is what a transcript
// implies.
//
// Every path, header and body below was read out of Honcho's own published
// client (`@honcho-ai/sdk`), not guessed: base https://api.honcho.dev, a bearer
// token, and the v3 routes.
//
// The rule this file lives by: nothing here may ever cost him a reply. Honcho
// being slow, down, or unreachable is a silent no-op — he simply answers with
// the memory he has on this machine, exactly as he did before.

// The real service. Overridable only so the test can stand a server in front
// of it and check the exact bytes on the wire.
const BASE = process.env.HONCHO_TEST_BASE || "https://api.honcho.dev";
const VERSION = "v3";

// These three still say "axis", and must keep saying it.
//
// They are not labels, they are IDENTIFIERS at Honcho: everything he has
// reasoned about over months is filed under them. Renaming them to match the
// rename would not move that memory across — it would silently start a second,
// empty workspace and leave the real one sitting there unread, which looks
// exactly like an assistant that has forgotten him.
//
/** Ids may only be letters, numbers, underscores and hyphens. */
const WORKSPACE = "axis";
const SESSION = "axis-main";

/** He and his principal are both "peers" — Honcho reasons about each of them. */
const PEER_USER = "principal";
const PEER_AXIS = "axis";

/** Long enough for a real answer, short enough never to be felt in a reply. */
const TIMEOUT_MS = 6000;

export function isHonchoConfigured(): boolean {
  return Boolean(getSetting("HONCHO_API_KEY"));
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  const key = getSetting("HONCHO_API_KEY");
  if (!key) throw new Error("No Honcho key is set.");

  const url = new URL(`/${VERSION}${path}`, BASE);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Honcho answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

// Workspaces, peers and sessions are get-or-create: posting one that exists
// returns it rather than complaining. So there is no "have I set this up yet"
// state to keep, and nothing to repair if the account is wiped — it is made
// again on the next message.
let ensured = false;

async function ensure(): Promise<void> {
  if (ensured) return;
  await call("POST", "/workspaces", { body: { id: WORKSPACE } });
  await Promise.all([
    call("POST", `/workspaces/${WORKSPACE}/peers`, { body: { id: PEER_USER } }),
    call("POST", `/workspaces/${WORKSPACE}/peers`, { body: { id: PEER_AXIS } }),
  ]);
  await call("POST", `/workspaces/${WORKSPACE}/sessions`, { body: { id: SESSION } });
  ensured = true;
}

export interface Exchange {
  /** What he said. */
  said: string;
  /** What Jarvis answered. */
  replied: string;
}

/**
 * Write a turn to Honcho, and never let it matter if that fails.
 *
 * Deliberately not awaited by the caller: Honcho reasons in the background on
 * its side, and there is nothing in the response worth waiting through. A
 * rejected promise here is caught here.
 */
export function remember(exchange: Exchange): void {
  if (!isHonchoConfigured()) return;

  void (async () => {
    try {
      await ensure();
      const messages = [];
      if (exchange.said.trim()) messages.push({ peer_id: PEER_USER, content: exchange.said });
      if (exchange.replied.trim()) messages.push({ peer_id: PEER_AXIS, content: exchange.replied });
      if (messages.length === 0) return;

      await call("POST", `/workspaces/${WORKSPACE}/sessions/${SESSION}/messages`, {
        body: { messages },
      });
    } catch {
      // A memory that couldn't be written is not worth a word to him. The
      // local memory has it either way.
      ensured = false;
    }
  })();
}

interface ContextResponse {
  summary?: { content?: string } | null;
  peer_representation?: string | null;
  peer_card?: string[] | string | null;
}

/**
 * What Honcho has worked out about him, as a paragraph for the prompt.
 *
 * `peer_representation` is Honcho's reasoning about the principal — the part
 * that is worth more than a transcript. The summary is the conversation so far
 * condensed. Both are asked for from Jarvis's point of view, which is what
 * `peer_perspective` means: what *Jarvis* should know about him.
 */
export async function recall(): Promise<string> {
  if (!isHonchoConfigured()) return "";

  try {
    await ensure();
    const context = await call<ContextResponse>(
      "GET",
      `/workspaces/${WORKSPACE}/sessions/${SESSION}/context`,
      {
        query: {
          summary: true,
          // Room for something substantial without crowding out the prompt he
          // is actually answering.
          tokens: 1200,
          peer_perspective: PEER_AXIS,
          peer_target: PEER_USER,
        },
      }
    );

    const parts: string[] = [];
    const card = Array.isArray(context.peer_card)
      ? context.peer_card.join("\n")
      : context.peer_card ?? "";
    if (card.trim()) parts.push(card.trim());
    if (context.peer_representation?.trim()) parts.push(context.peer_representation.trim());
    if (context.summary?.content?.trim()) parts.push(context.summary.content.trim());

    return parts.join("\n\n");
  } catch {
    ensured = false;
    return "";
  }
}

/**
 * Ask Honcho a question about him in plain words.
 *
 * This is the part that isn't retrieval: Honcho answers from what it has
 * reasoned, so "how does he like to be spoken to" gets an answer even though
 * nobody ever wrote that down.
 */
export async function askAbout(question: string): Promise<string> {
  if (!isHonchoConfigured()) return "";

  try {
    await ensure();
    const answer = await call<{ content?: string | null }>(
      "POST",
      `/workspaces/${WORKSPACE}/peers/${PEER_USER}/chat`,
      { body: { query: question, stream: false, session_id: SESSION } }
    );
    return answer.content?.trim() ?? "";
  } catch {
    ensured = false;
    return "";
  }
}

/**
 * Try a key against the real service, and say plainly what happened.
 *
 * Takes the key as an argument rather than reading the setting, because it is
 * called the moment he PASTES one — before it has been saved. Creating the
 * workspace is the probe: it needs a valid key, it is idempotent, and it is
 * the same call the first real use would make, so a key that passes here
 * cannot fail differently a minute later.
 *
 * This used to exist and be wired to nothing at all, which meant a wrong
 * Honcho key looked exactly like a working one until the day someone noticed
 * he had no long memory.
 */
export async function checkHonchoKey(key: string): Promise<string> {
  const url = new URL(`/${VERSION}/workspaces`, BASE);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ id: WORKSPACE }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Honcho refused that key. They are made at app.honcho.dev under API keys — " +
        "check the whole thing was copied, with no space on the end."
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Honcho returned ${res.status}.${body ? ` It said: ${body.slice(0, 160)}` : ""}`);
  }
  return `Working — his long memory is on, in workspace "${WORKSPACE}".`;
}
