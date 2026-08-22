import OpenAI from "openai";
import { geminiModel } from "./geminiModel";
import { getSetting } from "./settings";

// Axis's brain can run on either OpenAI or Google's Gemini — Gemini exposes
// an OpenAI-compatible endpoint, so the same "openai" SDK and the same
// chat-completions + tool-calling code in api/chat/route.ts work for both.
export type AIProvider = "openai" | "gemini" | "openrouter" | "anthropic";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// OpenRouter fronts most of the frontier models behind one OpenAI-compatible
// endpoint and one key, which is the point of using it: pick a stronger brain
// without changing any of this code.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Anthropic is the one provider that does NOT come through the OpenAI SDK.
// Its Messages API has its own shape, and it gets its own client in
// anthropicBrain.ts rather than an OpenAI-compatible shim — see the note there.
const ANTHROPIC_FALLBACK_MODEL = "claude-opus-5";

export function anthropicModel(): string {
  return getSetting("ANTHROPIC_MODEL") || ANTHROPIC_FALLBACK_MODEL;
}

/**
 * How hard Claude thinks before answering.
 *
 * Low by default, and deliberately: thinking happens before a single token is
 * emitted, so all of it is silence with the orb spinning. Deciding to open
 * Spotify does not need deliberation. Raise it if you would rather have
 * considered answers than quick ones.
 */
export function anthropicEffort(): "low" | "medium" | "high" | "xhigh" | "max" {
  const configured = getSetting("ANTHROPIC_EFFORT")?.toLowerCase();
  const allowed = ["low", "medium", "high", "xhigh", "max"] as const;
  const match = allowed.find((level) => level === configured);
  return match ?? "low";
}

/**
 * Used only if no model has been chosen. The Settings panel fetches the live
 * list from OpenRouter and lets you pick, so this is a starting point rather
 * than a recommendation — model names there change faster than this file does.
 */
export const OPENROUTER_FALLBACK_MODEL = "openai/gpt-4o";

// GitHub Models used to sit here. It was retired on 30 July 2026 — the whole
// service, not just a model — and its endpoint now answers every request with
// HTTP 410. A provider that cannot succeed is worse than a missing one, so it
// is gone rather than left in the list looking like an option.

function detectProvider(): AIProvider | null {
  const forced = getSetting("AI_PROVIDER")?.toLowerCase();
  if (forced === "gemini") return "gemini";
  if (forced === "openai") return "openai";
  if (forced === "openrouter") return "openrouter";
  if (forced === "anthropic") return "anthropic";

  // Auto: whichever key exists. Anthropic first — an Anthropic key is bought
  // deliberately and for one reason, and it is the strongest brain on the list.
  if (getSetting("ANTHROPIC_API_KEY")) return "anthropic";
  if (getSetting("OPENROUTER_API_KEY")) return "openrouter";
  if (getSetting("OPENAI_API_KEY")) return "openai";
  if (getSetting("GEMINI_API_KEY")) return "gemini";
  return null;
}

function keyFor(provider: AIProvider): string | undefined {
  if (provider === "anthropic") return getSetting("ANTHROPIC_API_KEY");
  if (provider === "gemini") return getSetting("GEMINI_API_KEY");
  if (provider === "openrouter") return getSetting("OPENROUTER_API_KEY");
  return getSetting("OPENAI_API_KEY");
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: "Anthropic",
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
      defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Axis" },
    });
  } else {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

/**
 * Gemini 2.5+ "thinks" before answering by default, which can add many seconds
 * to a reply as trivial as "hello". Axis is a conversational assistant, not a
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

/**
 * A ceiling on the reply length.
 *
 * Without one, providers assume the model's own maximum — 16k tokens on many
 * OpenRouter models — and OpenRouter refuses the request outright if your
 * balance couldn't cover a reply that long, even though the actual reply would
 * be three sentences. It also stops a runaway answer costing real money.
 * Axis is spoken aloud; a couple of thousand tokens is already far more than
 * anyone wants read to them.
 */
const DEFAULT_MAX_TOKENS = 2000;

/** Lowered at runtime when a provider tells us what the balance can afford. */
let learnedMaxTokens: number | null = null;

export function getMaxTokens(): number {
  const configured = Number(getSetting("MAX_TOKENS"));
  const base =
    Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_TOKENS;
  return learnedMaxTokens ? Math.min(base, learnedMaxTokens) : base;
}

/**
 * "You requested up to 16384 tokens, but can only afford 4000." Take the
 * number it offers rather than guessing, and keep some headroom — the balance
 * can move between one request and the next.
 */
export function adoptAffordableLimit(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /can only afford\s+(\d+)/i.exec(message);
  if (!match) return null;

  const affordable = Math.max(256, Math.floor(Number(match[1]) * 0.8));
  if (learnedMaxTokens !== null && affordable >= learnedMaxTokens) return null;

  learnedMaxTokens = affordable;
  return affordable;
}

/** True when a provider is refusing on cost rather than on correctness. */
export function isPaymentRequired(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === 402 || /can only afford|more credits/i.test(message);
}

export function getAIModel(): string {
  const provider = detectProvider();
  if (provider === "anthropic") return anthropicModel();
  if (provider === "gemini") return geminiModel();
  if (provider === "openrouter") {
    return getSetting("OPENROUTER_MODEL") || OPENROUTER_FALLBACK_MODEL;
  }
  return getSetting("OPENAI_MODEL") || "gpt-4o";
}
