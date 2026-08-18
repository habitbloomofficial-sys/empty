import OpenAI from "openai";
import { geminiModel } from "./geminiModel";
import { getSetting } from "./settings";

// JARVIS's brain can run on either OpenAI or Google's Gemini — Gemini exposes
// an OpenAI-compatible endpoint, so the same "openai" SDK and the same
// chat-completions + tool-calling code in api/chat/route.ts work for both.
export type AIProvider = "openai" | "gemini";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function detectProvider(): AIProvider | null {
  const forced = getSetting("AI_PROVIDER")?.toLowerCase();
  if (forced === "gemini") return "gemini";
  if (forced === "openai") return "openai";

  // Auto: prefer OpenAI if both are set, otherwise use whichever key exists.
  if (getSetting("OPENAI_API_KEY")) return "openai";
  if (getSetting("GEMINI_API_KEY")) return "gemini";
  return null;
}

function keyFor(provider: AIProvider): string | undefined {
  return provider === "gemini"
    ? getSetting("GEMINI_API_KEY")
    : getSetting("OPENAI_API_KEY");
}

export function isAIConfigured(): boolean {
  const provider = detectProvider();
  return provider !== null && Boolean(keyFor(provider));
}

// Only reports a provider once its key is actually present — an AI_PROVIDER
// override with no matching key should read as "not connected", not lie.
export function getAIProvider(): AIProvider | null {
  return isAIConfigured() ? detectProvider() : null;
}

let cachedClient: OpenAI | null = null;
let cachedProvider: AIProvider | null = null;
let cachedKey: string | null = null;

export function getAI(): OpenAI {
  const provider = detectProvider();
  const apiKey = provider ? keyFor(provider) : undefined;

  if (!provider || !apiKey) {
    throw new Error(
      provider
        ? `The AI provider is set to "${provider}", but no ${
            provider === "gemini" ? "Gemini" : "OpenAI"
          } API key has been saved yet — add one in Settings.`
        : "No AI brain configured yet, sir — add an OpenAI or Gemini API key in Settings."
    );
  }

  // Cache on the key too, so saving a new one in Settings takes effect
  // immediately instead of needing a server restart.
  if (cachedClient && cachedProvider === provider && cachedKey === apiKey) {
    return cachedClient;
  }

  cachedProvider = provider;
  cachedKey = apiKey;
  cachedClient =
    provider === "gemini"
      ? new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey });

  return cachedClient;
}

export function getAIModel(): string {
  const provider = detectProvider();
  if (provider === "gemini") return geminiModel();
  return getSetting("OPENAI_MODEL") || "gpt-4o";
}
