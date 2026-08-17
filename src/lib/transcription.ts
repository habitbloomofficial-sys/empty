import OpenAI from "openai";
import { isElevenLabsConfigured, speechToText } from "./elevenlabs";
import { getSetting } from "./settings";

// Server-side transcription is what makes the mic work in every browser: the
// built-in Web Speech API only exists in Chrome/Edge, needs Google's speech
// service to be reachable, and guesses the language from the browser locale.
// Recording in the browser and transcribing here avoids all three problems.

export function isTranscriptionConfigured(): boolean {
  return isElevenLabsConfigured() || Boolean(getSetting("OPENAI_API_KEY"));
}

export async function transcribeAudio(audio: Blob, filename: string): Promise<string> {
  // ElevenLabs Scribe first — the key is already needed for JARVIS's voice, so
  // it's the one most likely to be present, and it auto-detects language.
  if (isElevenLabsConfigured()) {
    return speechToText(audio, filename);
  }

  const openAIKey = getSetting("OPENAI_API_KEY");
  if (openAIKey) {
    // Whisper lives on OpenAI proper — Gemini's OpenAI-compatible endpoint
    // doesn't serve /audio/transcriptions, so this path needs a real OpenAI key.
    const client = new OpenAI({ apiKey: openAIKey });
    const file = new File([audio], filename, {
      type: audio.type || "audio/webm",
    });
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return (result.text ?? "").trim();
  }

  throw new Error(
    "No transcription service configured, sir — add an ElevenLabs or OpenAI API key in Settings."
  );
}
