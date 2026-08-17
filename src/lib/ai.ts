import OpenAI from "openai";

// JARVIS's brain can run on either OpenAI or Google's Gemini — Gemini exposes
// an OpenAI-compatible endpoint, so the same "openai" SDK and the same
// chat-completions + tool-calling code in api/chat/route.ts work for both.
export type AIProvider = "openai" | "gemini";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function detectProvider(): AIProvider | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  if (forced === "gemini") return "gemini";
  if (forced === "openai") return "openai";

  // Auto: prefer OpenAI if both are set, otherwise use whichever key exists.
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

function hasKeyFor(provider: AIProvider): boolean {
  return provider === "gemini"
    ? Boolean(process.env.GEMINI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

export function isAIConfigured(): boolean {
  const provider = detectProvider();
  return provider !== null && hasKeyFor(provider);
}

// Only reports a provider once its key is actually present — an AI_PROVIDER
// override with no matching key should read as "not connected", not lie.
export function getAIProvider(): AIProvider | null {
  return isAIConfigured() ? detectProvider() : null;
}

let cachedClient: OpenAI | null = null;
let cachedProvider: AIProvider | null = null;

export function getAI(): OpenAI {
  const provider = detectProvider();
  if (!provider || !hasKeyFor(provider)) {
    throw new Error(
      provider
        ? `AI_PROVIDER is set to "${provider}" but ${
            provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"
          } is missing from .env.local.`
        : "No AI brain configured. Add OPENAI_API_KEY or GEMINI_API_KEY to .env.local."
    );
  }

  if (cachedClient && cachedProvider === provider) return cachedClient;

  cachedProvider = provider;
  cachedClient =
    provider === "gemini"
      ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return cachedClient;
}

export function getAIModel(): string {
  const provider = detectProvider();
  if (provider === "gemini") {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }
  return process.env.OPENAI_MODEL || "gpt-4o";
}
