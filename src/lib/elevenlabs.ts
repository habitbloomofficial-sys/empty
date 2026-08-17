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

function modelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_turbo_v2_5";
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
    throw new Error(`ElevenLabs voice list failed: ${res.status} ${await res.text()}`);
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
    throw new Error(`ElevenLabs transcription failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export async function textToSpeech(
  text: string,
  voiceId?: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId || defaultVoiceId()}`,
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
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
  }

  return res.arrayBuffer();
}
