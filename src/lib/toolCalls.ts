// Reassembling a tool call from a stream is less tidy than it looks. The
// OpenAI protocol says a call arrives as fragments to be concatenated —
// `{"que`, `ry":"bo`, `wie"}` — but Gemini's OpenAI-compatible endpoint sends
// the whole thing in one delta, and will happily send it again in the next.
// Concatenating that gives `{}{}`, which is not JSON.
//
// So the fragments are still joined, and then read tolerantly: take the first
// complete value and ignore whatever repeats after it.

/** Find the first balanced JSON object or array, ignoring anything after. */
function firstJsonValue(text: string): string | null {
  const opener = text[0];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Braces inside a string are text, not structure.
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === opener) depth++;
    else if (char === closer && --depth === 0) return text.slice(0, i + 1);
  }

  return null;
}

/**
 * Turn a streamed arguments string into an object, recovering from a provider
 * that repeated itself. Throws only when there's genuinely nothing usable —
 * that surfaces to the model as a failed tool call it can retry, rather than
 * silently running with the wrong arguments.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  try {
    const parsed = asObject(JSON.parse(text));
    if (parsed) return parsed;
  } catch {
    // Fall through and try to salvage the leading value.
  }

  const first = firstJsonValue(text);
  if (first) {
    try {
      const parsed = asObject(JSON.parse(first));
      if (parsed) return parsed;
    } catch {
      // Nothing usable.
    }
  }

  throw new Error(`I couldn't read the arguments for that action: ${text.slice(0, 120)}`);
}

/**
 * The same duplication can affect the function name, giving
 * "open_spotifyopen_spotify". Collapsed only when the result is a tool that
 * actually exists, so a legitimately fragmented name is never mangled.
 */
export function normalizeToolName(raw: string, known: readonly string[]): string {
  const name = (raw ?? "").trim();
  if (!name || known.includes(name)) return name;

  for (let unitLength = 1; unitLength <= name.length / 2; unitLength++) {
    if (name.length % unitLength !== 0) continue;
    const unit = name.slice(0, unitLength);
    if (unit.repeat(name.length / unitLength) === name && known.includes(unit)) {
      return unit;
    }
  }

  return name;
}
