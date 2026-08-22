import { interpretElevenLabsError } from "./elevenlabsErrors";
import { getSetting, type SettingKey } from "./settings";
import { normalizeVoiceId } from "./voiceId";

/**
 * No probe may hang. Node's fetch has no timeout of its own, so a provider
 * that accepts the connection and then goes quiet holds the save request open
 * indefinitely — and the browser, which does give up, reports it as a bare
 * "Failed to fetch". Every check below is bounded so the panel always gets an
 * answer to show.
 */
const PROBE_TIMEOUT_MS = 10_000;

function timed(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) };
}

// Checking a key the moment it's pasted turns a confusing runtime failure
// ("transcription failed: 400 …") into an answer at the point of the mistake.
//
// The rule throughout: only call a key bad on positive proof that it's bad.
// A provider has a hundred reasons to refuse a request — a missing scope, a
// spent quota, a flagged account, an endpoint this key isn't allowed to touch
// — and telling someone their perfectly good key is wrong sends them off to
// regenerate it over and over. Anything short of "this key does not exist"
// gets saved with an explanation of what to look at instead.

export interface KeyCheck {
  key: SettingKey;
  ok: boolean;
  message: string;
}

type Verifier = (value: string) => Promise<KeyCheck["message"]>;

const VERIFIABLE: Partial<Record<SettingKey, Verifier>> = {
  ELEVENLABS_API_KEY: verifyElevenLabs,
  ELEVENLABS_VOICE_ID: verifyVoiceId,
  OPENAI_API_KEY: verifyOpenAI,
  GEMINI_API_KEY: verifyGemini,
  OPENROUTER_API_KEY: verifyOpenRouter,
  ANTHROPIC_API_KEY: verifyAnthropic,
  YOUTUBE_API_KEY: verifyYouTubeKey,
  YOUTUBE_CHANNEL: verifyYouTubeChannel,
};

export function isVerifiableKey(key: SettingKey): boolean {
  return key in VERIFIABLE;
}

/**
 * ElevenLabs keys can be "restricted", with a hand-picked set of permissions.
 * Such a key returns 401 from any endpoint outside its scope, so no single
 * probe can clear it — /v1/user needs `user_read`, which plenty of working
 * keys don't have. Probing several endpoints and reading the error bodies is
 * the only way to tell "not allowed here" from "not a real key".
 */
async function verifyElevenLabs(value: string): Promise<string> {
  const probes = ["/user", "/voices", "/models"];
  let restrictedNote: string | null = null;
  let lastMessage = "";

  for (const path of probes) {
    let res: Response;
    try {
      res = await fetch(`https://api.elevenlabs.io/v1${path}`, {
        headers: { "xi-api-key": value },
        cache: "no-store",
        ...timed(),
      });
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (res.ok) {
      return restrictedNote
        ? `Key verified. ${restrictedNote}`
        : "ElevenLabs key verified.";
    }

    const verdict = interpretElevenLabsError(res.status, await res.text());
    lastMessage = verdict.message;

    if (verdict.keyIsInvalid === true) {
      throw new Error(verdict.message);
    }
    if (verdict.keyIsInvalid === false) {
      // Authentication succeeded — the refusal was about scope, quota, or
      // account state, all of which mean the key itself is real.
      return `Key accepted. ${verdict.message}`;
    }
    // Inconclusive (a bare 401 with no detail): a restricted key looks like
    // this on an endpoint it can't touch, so try the next probe.
    restrictedNote =
      "It appears to be a restricted key — check that Text to Speech and Speech to Text are enabled for it in ElevenLabs.";
  }

  // Every probe refused without ever saying the key doesn't exist. Most often
  // that's a heavily restricted key, so save it and say what to check.
  return `Saved, but ElevenLabs wouldn't confirm it: ${lastMessage} If speech and voice stop working, edit the key in ElevenLabs (profile → API Keys) and give it access to all endpoints.`;
}

/**
 * A voice id is the one setting where being wrong is silent: speech simply
 * falls back to the browser's robot voice and nothing says why. So check it at
 * the point it's typed, and separate the three failures that look identical
 * from the outside — a mistyped id, a real id that hasn't been added to My
 * Voices, and a voice this account's plan can't reach.
 */
async function verifyVoiceId(value: string): Promise<string> {
  const id = normalizeVoiceId(value);
  if (!id) {
    throw new Error(
      "That doesn't contain a voice id. In ElevenLabs open Voices → My Voices, click the voice, and copy the ID — 20 characters like pNInz6obpgDQGcFmaJgB. A share link works here too."
    );
  }

  const key = getSetting("ELEVENLABS_API_KEY");
  if (!key) return `Voice id saved (${id}). Add your ElevenLabs key and I'll check it against your library.`;

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
      headers: { "xi-api-key": key },
      cache: "no-store",
      ...timed(),
    });
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { name?: string } | null;
    return body?.name ? `Voice set to “${body.name}”.` : "Voice id verified.";
  }

  // 404 is the interesting one, and the reason this check exists: the id is
  // real, it just isn't in this account yet.
  if (res.status === 404) {
    throw new Error(
      "ElevenLabs has no voice with that id in your library. If you copied it from the Voice Library, open the voice there and click “Add to my voices” first — then copy the id from Voices → My Voices."
    );
  }

  const verdict = interpretElevenLabsError(res.status, await res.text());
  if (verdict.keyIsInvalid === true) throw new Error(verdict.message);
  return `Voice id saved, but ElevenLabs wouldn't confirm it: ${verdict.message}`;
}

/**
 * A YouTube key, checked against the cheapest call in the API.
 *
 * i18nLanguages costs one quota unit and names nothing, which makes it a
 * better probe than looking up a real channel: it proves the key works and
 * that YouTube Data API v3 is switched on, without spending the daily budget
 * or hard-coding somebody else's channel into this file.
 */
async function verifyYouTubeKey(value: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&key=${encodeURIComponent(value)}`,
    { cache: "no-store", ...timed() }
  );
  if (res.ok) return "YouTube key verified.";

  const body = await res.text();
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) {
    throw new Error(
      "That key is real, but YouTube Data API v3 isn't enabled for its Google project. Open console.cloud.google.com → APIs & Services → Library, search “YouTube Data API v3”, and enable it — it's free."
    );
  }
  if (/ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED|referer/i.test(body)) {
    throw new Error(
      "That key is restricted to particular websites. Axis calls YouTube from your computer rather than a web page, so set the key's Application restrictions to “None”."
    );
  }
  if (/API_KEY_INVALID|API key not valid/i.test(body)) {
    throw new Error("Google says that key isn't valid. Copy it again in full.");
  }
  return `Saved, but Google wouldn't confirm it (HTTP ${res.status}).`;
}

/** The channel itself — resolved and named back, so it's clear it's the right one. */
async function verifyYouTubeChannel(value: string): Promise<string> {
  if (!getSetting("YOUTUBE_API_KEY") && !getSetting("GEMINI_API_KEY")) {
    return "Channel saved. Add a YouTube key and I'll confirm I can find it.";
  }
  const { channelStats } = await import("./youtube");
  let stats: Awaited<ReturnType<typeof channelStats>>;
  try {
    stats = await channelStats(value);
  } catch (err) {
    // The key check above already said this, in the same panel, a line higher.
    // Saying it twice reads as two problems.
    if (/key isn't valid|isn't switched on|restricted to particular|quota/i.test(String(err))) {
      return "Channel saved — I'll confirm it once the key above is working.";
    }
    throw err;
  }
  const subscribers = stats.subscribersHidden
    ? "subscribers hidden"
    : `${stats.subscribers?.toLocaleString() ?? "?"} subscribers`;
  return `Found “${stats.title}” — ${subscribers}, ${stats.videos.toLocaleString()} videos.`;
}

async function verifyOpenAI(value: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${value}` },
    cache: "no-store",
    ...timed(),
  });
  if (res.ok) return "OpenAI key verified.";

  const body = await res.text();
  if (res.status === 401 && /invalid_api_key|incorrect api key/i.test(body)) {
    throw new Error("OpenAI says that key doesn't exist. Create a fresh one and copy it in full.");
  }
  if (res.status === 429 || /quota/i.test(body)) {
    return "Key accepted, but the OpenAI account is out of quota.";
  }
  return `Saved, but OpenAI wouldn't confirm it (HTTP ${res.status}).`;
}

async function verifyGemini(value: string): Promise<string> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": value },
    cache: "no-store",
    ...timed(),
  });
  if (res.ok) return "Gemini key verified.";

  const body = await res.text();
  if (/API_KEY_INVALID|API key not valid/i.test(body)) {
    throw new Error(
      "Google says that key isn't valid. Make sure it's an API key from aistudio.google.com/apikey, copied in full."
    );
  }
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body)) {
    return "Key accepted, but the Generative Language API isn't enabled on that Google project yet.";
  }
  return `Saved, but Google wouldn't confirm it (HTTP ${res.status}).`;
}

/**
 * Anthropic has no "describe this key" endpoint, so the probe is the smallest
 * real request there is: one token to the cheapest model. It costs a fraction
 * of a cent and it proves the thing that matters — that the key exists, is
 * active, and has credit behind it.
 */
async function verifyAnthropic(value: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": value,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    cache: "no-store",
    ...timed(),
  });

  if (res.ok) return "Anthropic key verified.";

  const body = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Anthropic rejected that key. Keys start with sk-ant- — check it was copied in full and hasn't been revoked."
    );
  }
  if (res.status === 400 && /credit balance|billing/i.test(body)) {
    return "Key verified, but the account has no credit — buy some at console.anthropic.com before he can think.";
  }
  if (res.status === 429) {
    return "Key verified, but the account is rate limited right now.";
  }
  return `Saved, but Anthropic wouldn't confirm it (HTTP ${res.status}).`;
}

async function verifyOpenRouter(value: string): Promise<string> {
  // /key reports the credit and limits attached to this key specifically, so
  // it confirms the key rather than merely that OpenRouter is up.
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${value}` },
    cache: "no-store",
    ...timed(),
  });

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as {
      data?: { limit_remaining?: number | null; usage?: number };
    } | null;
    const remaining = body?.data?.limit_remaining;
    if (typeof remaining === "number" && remaining <= 0) {
      return "Key verified, but this OpenRouter key has no credit left.";
    }
    return "OpenRouter key verified.";
  }

  if (res.status === 401) {
    throw new Error("OpenRouter rejected that key. Keys start with sk-or- — check it was copied in full.");
  }
  return `Saved, but OpenRouter wouldn't confirm it (HTTP ${res.status}).`;
}

export async function verifyKey(key: SettingKey, value: string): Promise<KeyCheck | null> {
  const verifier = VERIFIABLE[key];
  if (!verifier || !value.trim()) return null;

  try {
    return { key, ok: true, message: await verifier(value.trim()) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A network failure says nothing about the key, so don't cry wolf.
    if (
      /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(message) ||
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
    ) {
      return {
        key,
        ok: true,
        message: "Saved — couldn't reach the provider to verify it right now.",
      };
    }
    return { key, ok: false, message };
  }
}
