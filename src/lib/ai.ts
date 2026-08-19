import OpenAI from "openai";
import { geminiModel } from "./geminiModel";
import { getSetting } from "./settings";

// JARVIS's brain can run on either OpenAI or Google's Gemini — Gemini exposes
// an OpenAI-compatible endpoint, so the same "openai" SDK and the same
// chat-completions + tool-calling code in api/chat/route.ts work for both.
export type AIProvider = "openai" | "gemini" | "openrouter";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// OpenRouter fronts most of the frontier models behind one OpenAI-compatible
// endpoint and one key, which is the point of using it: pick a stronger brain
// without changing any of this code.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Used only if no model has been chosen. The Settings panel fetches the live
 * list from OpenRouter and lets you pick, so this is a starting point rather
 * than a recommendation — model names there change faster than this file does.
 */
export const OPENROUTER_FALLBACK_MODEL = "openai/gpt-4o";

function detectProvider(): AIProvider | null {
  const forced = getSetting("AI_PROVIDER")?.toLowerCase();
  if (forced === "gemini") return "gemini";
  if (forced === "openai") return "openai";
  if (forced === "openrouter") return "openrouter";

  // Auto: whichever key exists. OpenRouter first — someone who configured it
  // did so to reach a better model than the one they already had.
  if (getSetting("OPENROUTER_API_KEY")) return "openrouter";
  if (getSetting("OPENAI_API_KEY")) return "openai";
  if (getSetting("GEMINI_API_KEY")) return "gemini";
  return null;
}

function keyFor(provider: AIProvider): string | undefined {
  if (provider === "gemini") return getSetting("GEMINI_API_KEY");
  if (provider === "openrouter") return getSetting("OPENROUTER_API_KEY");
  return getSetting("OPENAI_API_KEY");
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

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
        ? `The AI provider is set to "${provider}", but no ${PROVIDER_LABELS[provider]} API key has been saved yet — add one in Settings.`
        : "No AI brain configured yet, sir — add a Gemini, OpenRouter, or OpenAI API key in Settings."
    );
  }

  // Cache on the key too, so saving a new one in Settings takes effect
  // immediately instead of needing a server restart.
  if (cachedClient && cachedProvider === provider && cachedKey === apiKey) {
    return cachedClient;
  }

  cachedProvider = provider;
  cachedKey = apiKey;

  if (provider === "gemini") {
    cachedClient = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL });
  } else if (provider === "openrouter") {
    cachedClient = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      // OpenRouter attributes traffic by these; harmless, and it keeps the
      // request identifiable in your own dashboard.
      defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "JARVIS" },
    });
  } else {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

/**
 * Gemini 2.5+ "thinks" before answering by default, which can add many seconds
 * to a reply as trivial as "hello". JARVIS is a conversational assistant, not a
 * reasoning benchmark, so we ask for the lowest effort that still leaves it
 * able to decide whether to reach for a tool.
 */
export function getReasoningEffort(): string | null {
  if (detectProvider() !== "gemini") return null;
  const configured = getSetting("GEMINI_REASONING_EFFORT")?.toLowerCase();
  const allowed = ["none", "minimal", "low", "medium", "high"];
  if (configured && allowed.includes(configured)) return configured;
  // None by default. Thinking happens before a single token is emitted, so
  // every second of it is a second of silence — and deciding to open Spotify
  // needs no deliberation. Raise it if you want considered answers over quick
  // ones.
  return "none";
}

/** True when an error looks like the endpoint rejecting reasoning_effort. */
export function isUnsupportedParameter(error: unknown, parameter: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(parameter) &&
    /\b400\b|unknown name|invalid[_ ]argument|unsupported|unrecognized|not supported/i.test(
      message
    )
  );
}

export function getAIModel(): string {
  const provider = detectProvider();
  if (provider === "gemini") return geminiModel();
  if (provider === "openrouter") {
    return getSetting("OPENROUTER_MODEL") || OPENROUTER_FALLBACK_MODEL;
  }
  return getSetting("OPENAI_MODEL") || "gpt-4o";
}
