import { NextResponse } from "next/server";
import { isAIConfigured, getAIProvider } from "@/lib/ai";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { areGmailCredentialsConfigured, isGmailConfigured, redirectUri } from "@/lib/gmail";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isTranscriptionConfigured } from "@/lib/transcription";
import type { IntegrationStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status: IntegrationStatus = {
    brain: isAIConfigured(),
    brainProvider: getAIProvider(),
    elevenlabs: isElevenLabsConfigured(),
    transcription: isTranscriptionConfigured(),
    gmail: isGmailConfigured(),
    gmailCredentials: areGmailCredentialsConfigured(),
    gmailRedirectUri: redirectUri(),
    whatsapp: isWhatsAppConfigured(),
  };
  return NextResponse.json(status);
}
