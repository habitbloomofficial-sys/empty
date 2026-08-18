import OpenAI from "openai";
import { isElevenLabsConfigured, speechToText } from "./elevenlabs";
import { adoptGeminiReplacement, geminiModel, isModelNotFound } from "./geminiModel";
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
  const data = Buffer.from(await audio.arrayBuffer()).toString("base64");

  const call = async (model: string) => {
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
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res;
  };

  let res: Response;
  try {
    res = await call(geminiModel());
  } catch (err) {
    // A retired model 404s and names its successor — adopt it and retry once.
    const replacement = isModelNotFound(err) ? adoptGeminiReplacement(err) : null;
    if (!replacement) throw err;
    res = await call(replacement);
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

// Whether a failure will keep happening until someone changes a setting — a
// rejected key, a missing scope, a spent quota. Those are worth remembering;
// a one-off network blip is not.
function isPersistentCredentialFailure(message: string): boolean {
  return /\b(401|403)\b|invalid[_ ]api[_ ]key|authentication_error|unauthorized|api[_ ]key[_ ]not[_ ]valid|api_key_id_used_as_api_key|permission_denied|missing[_ ]permissions?|missing a permission|restricted|unusual activity|quota|out of credits|insufficient/i.test(
    message
  );
}

function friendlyError(provider: string, message: string): string {
  // The ElevenLabs client already translates its own failures, and Gemini's
  // key errors are self-explanatory — don't re-wrap a message that already
  // names its provider and says what to do.
  if (message.includes(provider)) return message.slice(0, 300);

  if (/api[_ ]key[_ ]not[_ ]valid|API_KEY_INVALID/i.test(message)) {
    return `${provider}: that API key was rejected — check it in Settings.`;
  }
  if (isPersistentCredentialFailure(message)) {
    return `${provider}: the API key was refused — check it in Settings.`;
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
      if (isPersistentCredentialFailure(message)) {
        recentAuthFailures.set(`${provider.name}:${provider.credential}`, Date.now());
      }
      failures.push(friendlyError(provider.name, message));
    }
  }

  throw new Error(`I couldn't transcribe that, sir. ${failures.join(" ")}`);
}
