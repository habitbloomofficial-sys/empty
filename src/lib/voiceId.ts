// Turning whatever someone pasted into a voice id. Nobody copies a bare id:
// they copy a Voice Library URL, or the "Voice ID" row from the ElevenLabs
// panel (label and all), or the id with a stray quote around it. Every one of
// those is unmistakably a voice id to a human, so none of them should be an
// error. Pure — no network, no config — so the rules can be tested directly.

/** ElevenLabs ids are 20 characters of base62. Room either side for change. */
const ID_PATTERN = /[A-Za-z0-9]{18,24}/;

/** True if this is exactly an id and nothing else. */
export function looksLikeVoiceId(value: string): boolean {
  return /^[A-Za-z0-9]{18,24}$/.test(value);
}

/**
 * The id inside whatever was pasted, or "" if there's nothing id-shaped in it.
 * Accepts a bare id, a Voice Library or voice-lab URL, and a labelled line
 * such as `Voice ID: pNInz6obpgDQGcFmaJgB`.
 */
export function normalizeVoiceId(raw: string): string {
  let value = raw.trim();
  if (!value) return "";

  // Paired wrapping punctuation — quotes from a copied JSON field, backticks
  // from a code block, angle brackets from a chat client.
  const pairs: Record<string, string> = { '"': '"', "'": "'", "`": "`", "<": ">", "(": ")" };
  while (value.length > 1 && pairs[value[0]] === value[value.length - 1]) {
    value = value.slice(1, -1).trim();
  }

  if (looksLikeVoiceId(value)) return value;

  // A URL: the id is in ?voice_id=/?voiceId=, otherwise it's a path segment.
  const url = value.match(/https?:\/\/\S+/i)?.[0];
  if (url) {
    try {
      const parsed = new URL(url);
      for (const [key, param] of parsed.searchParams) {
        if (/voice_?id/i.test(key) && looksLikeVoiceId(param)) return param;
      }
      const segment = parsed.pathname.split("/").reverse().find(looksLikeVoiceId);
      if (segment) return segment;
    } catch {
      // Not a parseable URL after all; the generic scan below still applies.
    }
  }

  // Anything else — a label, surrounding prose — take the first id-shaped run.
  // Only when the rest is punctuation and words, so a sentence that happens to
  // contain a long word doesn't get mistaken for an id.
  return ID_PATTERN.exec(value)?.[0] ?? "";
}
