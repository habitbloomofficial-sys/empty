import { interpretElevenLabsError } from "./elevenlabsErrors";
import type { SettingKey } from "./settings";

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
  OPENAI_API_KEY: verifyOpenAI,
  GEMINI_API_KEY: verifyGemini,
  OPENROUTER_API_KEY: verifyOpenRouter,
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

async function verifyOpenAI(value: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${value}` },
    cache: "no-store",
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

async function verifyOpenRouter(value: string): Promise<string> {
  // /key reports the credit and limits attached to this key specifically, so
  // it confirms the key rather than merely that OpenRouter is up.
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${value}` },
    cache: "no-store",
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
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(message)) {
      return {
        key,
        ok: true,
        message: "Saved — couldn't reach the provider to verify it right now.",
      };
    }
    return { key, ok: false, message };
  }
}
