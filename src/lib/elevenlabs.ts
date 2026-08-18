import { interpretElevenLabsError } from "./elevenlabsErrors";
import { getSetting } from "./settings";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

// Adam — a deep, composed, classic ElevenLabs premade voice. A solid default
// for a JARVIS-style butler voice. Override with ELEVENLABS_VOICE_ID.
const FALLBACK_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

// Resolved per call rather than at module load, so a voice saved in Settings
// applies without restarting the server.
export function defaultVoiceId(): string {
  return getSetting("ELEVENLABS_VOICE_ID") || FALLBACK_VOICE_ID;
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
  const res = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw await elevenLabsError(res, "Couldn't list ElevenLabs voices");
  }
  const data = (await res.json()) as { voices: ElevenLabsVoice[] };
  return data.voices;
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

  const res = await fetch(`${ELEVENLABS_API_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  });

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
  const res = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId || defaultVoiceId()}/stream?output_format=mp3_44100_128`,
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
    }
  );

  if (!res.ok) {
    throw await elevenLabsError(res, "ElevenLabs couldn't speak that");
  }
  if (!res.body) {
    throw new Error("ElevenLabs returned no audio, sir.");
  }

  return res.body;
}
