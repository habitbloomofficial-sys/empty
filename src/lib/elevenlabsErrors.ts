// Pure interpretation of ElevenLabs error payloads — no network, no config,
// so it can be reasoned about and tested on its own.

export interface ElevenLabsFailure {
  /**
   * true  — the key itself is wrong.
   * false — the key is genuine; something else (scope, quota, account state)
   *         is in the way.
   * null  — can't tell from the response.
   */
  keyIsInvalid: boolean | null;
  message: string;
}

/**
 * ElevenLabs answers a great many different problems with a bare 401, so the
 * body is the only thing that says what actually went wrong. A restricted key
 * missing one permission looks identical, at the status-code level, to a key
 * that was typed in wrong — and telling someone their correct key is wrong
 * sends them in circles.
 */
export function interpretElevenLabsError(
  httpStatus: number,
  rawBody: string
): ElevenLabsFailure {
  let status = "";
  let detail = "";

  try {
    const parsed = JSON.parse(rawBody) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      detail = parsed.detail;
    } else if (parsed.detail && typeof parsed.detail === "object") {
      const record = parsed.detail as Record<string, unknown>;
      status = typeof record.status === "string" ? record.status : "";
      detail = typeof record.message === "string" ? record.message : "";
    }
  } catch {
    detail = rawBody.slice(0, 200);
  }

  const haystack = `${status} ${detail}`;

  if (/api_key_id_used_as_api_key/i.test(haystack)) {
    return {
      keyIsInvalid: true,
      message:
        "That's the key's ID, not the key itself. In ElevenLabs go to your profile → API Keys, create a new key, and copy the value shown once at creation.",
    };
  }

  if (/missing_permissions|missing the permission/i.test(haystack)) {
    return {
      keyIsInvalid: false,
      message:
        "The key is genuine but restricted — it's missing a permission it needs. Edit the key in ElevenLabs (profile → API Keys) and enable Text to Speech, Speech to Text, and Voices, or just give it access to all endpoints." +
        (detail ? ` ElevenLabs said: ${detail}` : ""),
    };
  }

  if (/detected_unusual_activity|unusual activity/i.test(haystack)) {
    return {
      keyIsInvalid: false,
      message:
        "The key is fine, but ElevenLabs has flagged the account for unusual activity — this happens on the free tier behind a VPN or shared connection. Turn off any VPN, or upgrade the account, then try again.",
    };
  }

  if (/quota_exceeded|quota|credits/i.test(haystack)) {
    return {
      keyIsInvalid: false,
      message: "The key is fine, but the account is out of credits for this month.",
    };
  }

  if (/invalid_api_key|api key.*(invalid|not found)|invalid.*api key/i.test(haystack)) {
    return {
      keyIsInvalid: true,
      message: "ElevenLabs says that key doesn't exist. Create a fresh one and copy it in full.",
    };
  }

  return {
    keyIsInvalid: null,
    message: `ElevenLabs returned HTTP ${httpStatus}${detail ? `: ${detail}` : "."}`,
  };
}
