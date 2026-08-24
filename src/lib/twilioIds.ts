// Telling someone their Twilio credentials are wrong before they find out the
// hard way.
//
// Both of these are 34-character strings of hex that look like each other, sit
// next to each other on the same page, and mean entirely different things. They
// get swapped, half-copied, and confused with the API keys further down that
// page — and every one of those mistakes surfaces later as a bare "401
// Unauthorized" when a call fails, which explains nothing.
//
// None of this proves a credential is *right*. It catches the ones that cannot
// possibly be right, which is most of the ones people actually paste.

export interface CredentialCheck {
  ok: boolean;
  /** Said to the user. Empty when there is nothing worth saying. */
  message: string;
}

const HEX_32 = /^[0-9a-fA-F]{32}$/;

/**
 * The Account SID: "AC" followed by 32 hex characters.
 *
 * The prefix is the useful part. Twilio's other identifiers start with SK (API
 * keys), MG (messaging services), PN (phone numbers) and so on, and they are
 * all the same length and shape — so a wrong prefix is someone having copied
 * the line below the one they meant.
 */
export function checkAccountSid(raw: string): CredentialCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: "" };

  if (/^SK/.test(value)) {
    return {
      ok: false,
      message:
        "That's an API Key SID (it starts with SK), not the Account SID. The Account SID starts with AC and is at the top of the console home page.",
    };
  }
  if (/^(MG|PN|IS|VA|US)/.test(value)) {
    return {
      ok: false,
      message: `That's a different Twilio identifier (it starts with ${value.slice(0, 2)}). The Account SID starts with AC.`,
    };
  }
  if (HEX_32.test(value)) {
    return {
      ok: false,
      message:
        "That looks like the Auth Token rather than the Account SID — the SID is the one starting with AC.",
    };
  }
  if (!/^AC/.test(value)) {
    return { ok: false, message: "An Account SID starts with AC." };
  }
  if (!HEX_32.test(value.slice(2))) {
    return {
      ok: false,
      message:
        value.length < 34
          ? "That Account SID is too short — it should be AC followed by 32 characters."
          : "That doesn't look like a complete Account SID. It's AC followed by 32 letters and numbers.",
    };
  }
  return { ok: true, message: "" };
}

/** The Auth Token: 32 hex characters, no prefix. */
export function checkAuthToken(raw: string): CredentialCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: "" };

  if (/^AC/.test(value)) {
    return {
      ok: false,
      message:
        "That's the Account SID, not the Auth Token. The token sits beside it and has no AC in front of it — click Show to reveal it.",
    };
  }
  if (/^SK/.test(value)) {
    return {
      ok: false,
      message: "That's an API Key SID rather than the Auth Token.",
    };
  }
  if (!HEX_32.test(value)) {
    return {
      ok: false,
      message:
        value.length < 32
          ? "That Auth Token is too short — it should be 32 letters and numbers."
          : "That doesn't look like an Auth Token: 32 letters and numbers, nothing else.",
    };
  }
  return { ok: true, message: "" };
}

/**
 * A phone number in the form Twilio wants: E.164, so a plus and digits.
 *
 * People paste what the console displays, which is prettified with spaces and
 * brackets, and that is not what the API accepts.
 */
export function checkPhoneNumber(raw: string): CredentialCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: "" };

  const cleaned = value.replace(/^whatsapp:/i, "");
  if (!cleaned.startsWith("+")) {
    return {
      ok: false,
      message: "Numbers need the country code with a + in front, like +4512345678.",
    };
  }
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned.replace(/[\s()-]/g, ""))) {
    return { ok: false, message: "That doesn't look like a complete phone number." };
  }
  if (/[\s()-]/.test(cleaned)) {
    return {
      ok: false,
      message: "Spaces and brackets have to come out — just the plus and the digits.",
    };
  }
  return { ok: true, message: "" };
}
