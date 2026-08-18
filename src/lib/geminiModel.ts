import { getSetting } from "./settings";

// Google retires Gemini models on its own schedule, and a retired one answers
// every request with 404. Rather than hard-coding a name that goes stale and
// breaks the app for anyone who hasn't pulled, we take Google at its word:
// the 404 body names the replacement, so we adopt it and carry on.

const FALLBACK_MODEL = "gemini-3.6-flash";

// Learned at runtime from a deprecation notice. Process-lifetime only — the
// next restart re-learns it, which is what we want if Google changes course.
let learnedModel: string | null = null;

export function geminiModel(): string {
  return learnedModel || getSetting("GEMINI_MODEL") || FALLBACK_MODEL;
}

/**
 * If an error is Google telling us the model moved, return the model it points
 * at and remember it for subsequent calls. Returns null for anything else.
 */
export function adoptGeminiReplacement(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);

  // "This model models/gemini-2.5-flash is no longer available to new users.
  //  Please update your code to use models/gemini-3.6-flash for the latest…"
  const match = /(?:use|to)\s+models\/([A-Za-z0-9._-]+)/.exec(message);
  const replacement = match?.[1];
  if (!replacement || replacement === geminiModel()) return null;

  learnedModel = replacement;
  return replacement;
}

/** Whether an error looks like "that model isn't there", worth one retry. */
export function isModelNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not[_ ]found|no longer available|is not supported|NOT_FOUND/i.test(message);
}
