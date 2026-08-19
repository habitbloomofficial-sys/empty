import { interpretElevenLabsError } from "./elevenlabsErrors";
import { getSetting } from "./settings";
import { normalizeVoiceId } from "./voiceId";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Every call out to ElevenLabs is bounded.
 *
 * Node's fetch has no timeout of its own, so a stalled connection hangs the
 * request handler for as long as the socket stays open. The browser gives up
 * long before that and reports a bare "Failed to fetch", which reads as "the
 * app is broken" rather than "the network went quiet". A deadline turns that
 * into a sentence someone can act on.
 */
const REQUEST_TIMEOUT_MS = 15_000;
// Speech is generated as it plays, so the meter runs for the length of the
// utterance, not the length of a round trip.
const SPEECH_TIMEOUT_MS = 45_000;

/** A timed request, with the deadline reported as a sentence rather than a DOMException. */
export async function elevenLabsFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(`${ELEVENLABS_API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(
        `ElevenLabs didn't answer within ${Math.round(timeoutMs / 1000)} seconds — the connection to them is down or very slow.`
      );
    }
    throw err;
  }
}

// Adam — a deep, composed, classic ElevenLabs premade voice. A solid default
// for a JARVIS-style butler voice. Override with ELEVENLABS_VOICE_ID.
const FALLBACK_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

// Resolved per call rather than at module load, so a voice saved in Settings
// applies without restarting the server.
export function defaultVoiceId(): string {
  // Normalized on the way out as well as on the way in: a value that predates
  // this (or was typed straight into .env.local) still resolves to an id.
  return normalizeVoiceId(getSetting("ELEVENLABS_VOICE_ID") ?? "") || FALLBACK_VOICE_ID;
}

// Flash is ElevenLabs' lowest-latency model — the difference is very audible
// as time-to-first-word in conversation. Override with ELEVENLABS_MODEL_ID
// (eleven_turbo_v2_5 or eleven_multilingual_v2) to trade speed for polish.
function modelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_flash_v2_5";
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(getSetting("ELEVENLABS_API_KEY"));
}

function apiKey(): string {
  const key = getSetting("ELEVENLABS_API_KEY");
  if (!key) {
    throw new Error(
      "No ElevenLabs API key saved yet, sir — add one in Settings to give me a voice."
    );
  }
  return key;
}

async function elevenLabsError(res: Response, what: string): Promise<Error> {
  const { message } = interpretElevenLabsError(res.status, await res.text());
  return new Error(`${what}: ${message}`);
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const res = await elevenLabsFetch("/voices", { headers: { "xi-api-key": apiKey() } });
  if (!res.ok) {
    throw await elevenLabsError(res, "Couldn't list ElevenLabs voices");
  }
  const data = (await res.json()) as { voices: ElevenLabsVoice[] };
  return data.voices;
}

/**
 * One voice, by id — the check behind "is this id actually usable?".
 *
 * A voice from the Voice Library has an id long before it has anything to do
 * with your account. Until it's been added to My Voices this returns 404, and
 * that distinction is the whole difference between "wrong id" and "right id,
 * not added yet".
 */
export async function getVoice(voiceId: string): Promise<ElevenLabsVoice | null> {
  const res = await elevenLabsFetch(`/voices/${encodeURIComponent(voiceId)}`, {
    headers: { "xi-api-key": apiKey() },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw await elevenLabsError(res, "Couldn't check that voice");
  }
  return (await res.json()) as ElevenLabsVoice;
}

/**
 * Transcribe recorded audio with ElevenLabs Scribe. Language is auto-detected,
 * which matters — the browser's own speech API is pinned to one locale and
 * mishears anyone whose browser language doesn't match what they're speaking.
 */
export async function speechToText(audio: Blob, filename = "speech.webm"): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model_id", "scribe_v1");

  const res = await elevenLabsFetch(
    "/speech-to-text",
    { method: "POST", headers: { "xi-api-key": apiKey() }, body: form },
    SPEECH_TIMEOUT_MS
  );

  if (!res.ok) {
    throw await elevenLabsError(res, "ElevenLabs transcription failed");
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Speech as a stream. Waiting for the whole file before playing anything meant
 * silence for as long as the entire utterance took to generate; streaming lets
 * playback start on the first chunk.
 */
export async function textToSpeechStream(
  text: string,
  voiceId?: string
): Promise<ReadableStream<Uint8Array>> {
  const res = await elevenLabsFetch(
    `/text-to-speech/${encodeURIComponent(normalizeVoiceId(voiceId ?? "") || defaultVoiceId())}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId(),
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
    SPEECH_TIMEOUT_MS
  );

  if (!res.ok) {
    throw await elevenLabsError(res, "ElevenLabs couldn't speak that");
  }
  if (!res.body) {
    throw new Error("ElevenLabs returned no audio, sir.");
  }

  return res.body;
}
