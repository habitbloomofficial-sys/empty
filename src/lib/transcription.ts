import OpenAI from "openai";
import { isElevenLabsConfigured, speechToText } from "./elevenlabs";
import { getSetting } from "./settings";

// Server-side transcription is what makes the mic work in every browser: the
// built-in Web Speech API only exists in Chrome/Edge, needs Google's speech
// service to be reachable, and guesses the language from the browser locale.
//
// Three services can do the job, and any one of them is enough — whichever
// keys are present get tried in turn, so a bad or expired key on one doesn't
// leave JARVIS deaf.

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const TRANSCRIBE_PROMPT =
  "Transcribe the speech in this audio exactly as spoken, in whatever language " +
  "is being spoken. Reply with the transcription alone — no commentary, no " +
  "speaker labels, no surrounding quotation marks. If there is no intelligible " +
  "speech, reply with nothing at all.";

interface Provider {
  name: string;
  /** The key in use, so a corrected key clears any remembered failure. */
  credential: string;
  run: (audio: Blob, filename: string, mimeType: string) => Promise<string>;
}

function availableProviders(): Provider[] {
  const providers: Provider[] = [];

  const elevenLabsKey = getSetting("ELEVENLABS_API_KEY");
  if (isElevenLabsConfigured() && elevenLabsKey) {
    providers.push({
      name: "ElevenLabs",
      credential: elevenLabsKey,
      run: (audio, filename) => speechToText(audio, filename),
    });
  }

  // Whisper lives on OpenAI proper — Gemini's OpenAI-compatible endpoint
  // doesn't serve /audio/transcriptions, so this needs a real OpenAI key.
  const openAIKey = getSetting("OPENAI_API_KEY");
  if (openAIKey) {
    providers.push({
      name: "OpenAI Whisper",
      credential: openAIKey,
      run: async (audio, filename, mimeType) => {
        const client = new OpenAI({ apiKey: openAIKey });
        const file = new File([audio], filename, { type: mimeType });
        const result = await client.audio.transcriptions.create({
          file,
          model: "whisper-1",
        });
        return (result.text ?? "").trim();
      },
    });
  }

  const geminiKey = getSetting("GEMINI_API_KEY");
  if (geminiKey) {
    providers.push({
      name: "Gemini",
      credential: geminiKey,
      run: (audio, _filename, mimeType) => transcribeWithGemini(audio, mimeType, geminiKey),
    });
  }

  return providers;
}

export function isTranscriptionConfigured(): boolean {
  return availableProviders().length > 0;
}

async function transcribeWithGemini(
  audio: Blob,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const model = getSetting("GEMINI_MODEL") || "gemini-2.5-flash";
  const data = Buffer.from(await audio.arrayBuffer()).toString("base64");

  const res = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { mimeType, data } }],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  // Models occasionally wrap a transcription in quotes despite the prompt.
  return text.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

// A provider whose key was just rejected is skipped for a while, so one bad
// key doesn't add a failed round-trip to every single thing you say. Keyed on
// the credential itself, so saving a corrected key retries immediately.
const AUTH_FAILURE_TTL_MS = 10 * 60 * 1000;
const recentAuthFailures = new Map<string, number>();

function looksLikeAuthFailure(message: string): boolean {
  return /\b(401|403)\b|invalid[_ ]api[_ ]key|authentication_error|unauthorized|api[_ ]key[_ ]not[_ ]valid|api_key_id_used_as_api_key|permission_denied/i.test(
    message
  );
}

function friendlyError(provider: string, message: string): string {
  if (/api_key_id_used_as_api_key/i.test(message)) {
    return `${provider}: you've pasted the key's ID rather than the key itself. In ElevenLabs open your profile → API Keys, create a new key, and copy the value it shows you once at creation.`;
  }
  if (looksLikeAuthFailure(message)) {
    return `${provider}: the API key was rejected — check it in Settings.`;
  }
  if (/quota|rate[_ ]limit|429|insufficient/i.test(message)) {
    return `${provider}: out of quota or rate limited.`;
  }
  return `${provider}: ${message.slice(0, 200)}`;
}

export async function transcribeAudio(
  audio: Blob,
  filename: string,
  mimeType: string
): Promise<string> {
  const providers = availableProviders();
  if (providers.length === 0) {
    throw new Error(
      "No transcription service configured, sir — add a Gemini, ElevenLabs, or OpenAI API key in Settings."
    );
  }

  const now = Date.now();
  const healthy = providers.filter((provider) => {
    const failedAt = recentAuthFailures.get(`${provider.name}:${provider.credential}`);
    return !failedAt || now - failedAt > AUTH_FAILURE_TTL_MS;
  });
  // If every provider is in the penalty box, try them all again rather than
  // refusing outright — the outage may well have cleared.
  const queue = healthy.length > 0 ? healthy : providers;

  const failures: string[] = [];
  for (const provider of queue) {
    try {
      const text = await provider.run(audio, filename, mimeType);
      recentAuthFailures.delete(`${provider.name}:${provider.credential}`);
      if (text) return text;
      // An empty result means silence, not a broken provider — don't burn
      // time and tokens asking the next service the same question.
      return "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (looksLikeAuthFailure(message)) {
        recentAuthFailures.set(`${provider.name}:${provider.credential}`, Date.now());
      }
      failures.push(friendlyError(provider.name, message));
    }
  }

  throw new Error(`I couldn't transcribe that, sir. ${failures.join(" ")}`);
}
