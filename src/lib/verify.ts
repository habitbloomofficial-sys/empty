import type { SettingKey } from "./settings";

// Checking a key the moment it's pasted turns a confusing runtime failure
// ("transcription failed: 400 …") into an answer at the point of the mistake.

export interface KeyCheck {
  key: SettingKey;
  ok: boolean;
  message: string;
}

const VERIFIABLE: Partial<Record<SettingKey, (value: string) => Promise<KeyCheck["message"]>>> = {
  ELEVENLABS_API_KEY: verifyElevenLabs,
  OPENAI_API_KEY: verifyOpenAI,
  GEMINI_API_KEY: verifyGemini,
};

export function isVerifiableKey(key: SettingKey): boolean {
  return key in VERIFIABLE;
}

/** Resolves with a success message, or throws with a human-readable reason. */
async function verifyElevenLabs(value: string): Promise<string> {
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": value },
    cache: "no-store",
  });
  if (res.ok) return "ElevenLabs key verified.";

  const body = await res.text();
  if (/api_key_id_used_as_api_key/i.test(body)) {
    throw new Error(
      "That's the key's ID, not the key itself. In ElevenLabs go to your profile → API Keys, create a new key, and copy the value shown once at creation (it starts with sk_)."
    );
  }
  if (res.status === 401) {
    throw new Error("ElevenLabs rejected that key. Check it was copied in full.");
  }
  throw new Error(`ElevenLabs couldn't verify that key (HTTP ${res.status}).`);
}

async function verifyOpenAI(value: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${value}` },
    cache: "no-store",
  });
  if (res.ok) return "OpenAI key verified.";
  if (res.status === 401) {
    throw new Error("OpenAI rejected that key. Check it was copied in full and is still active.");
  }
  if (res.status === 429) {
    throw new Error("That OpenAI key is valid but out of quota.");
  }
  throw new Error(`OpenAI couldn't verify that key (HTTP ${res.status}).`);
}

async function verifyGemini(value: string): Promise<string> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": value },
    cache: "no-store",
  });
  if (res.ok) return "Gemini key verified.";
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error(
      "Google rejected that key. Make sure it's an API key from aistudio.google.com/apikey, copied in full."
    );
  }
  throw new Error(`Google couldn't verify that key (HTTP ${res.status}).`);
}

export async function verifyKey(key: SettingKey, value: string): Promise<KeyCheck | null> {
  const verifier = VERIFIABLE[key];
  if (!verifier || !value.trim()) return null;

  try {
    return { key, ok: true, message: await verifier(value.trim()) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A network failure here says nothing about the key, so don't cry wolf.
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
      return {
        key,
        ok: true,
        message: "Saved — couldn't reach the provider to verify it right now.",
      };
    }
    return { key, ok: false, message };
  }
}
