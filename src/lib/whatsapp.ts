import twilio from "twilio";

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

function normalizeWhatsAppNumber(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

export async function sendWhatsAppMessage(params: {
  to: string;
  message: string;
}): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!sid || !token || !from) {
    throw new Error(
      "WhatsApp isn't configured yet, sir — add your Twilio credentials to .env.local (see README)."
    );
  }

  const to = params.to.trim() || process.env.TWILIO_WHATSAPP_TO_DEFAULT;
  if (!to) {
    throw new Error(
      "No recipient number given, and no default WhatsApp recipient is configured."
    );
  }

  const client = twilio(sid, token);
  const result = await client.messages.create({
    from: normalizeWhatsAppNumber(from),
    to: normalizeWhatsAppNumber(to),
    body: params.message,
  });
  return { sid: result.sid };
}
