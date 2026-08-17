import { NextResponse } from "next/server";
import { isAIConfigured, getAIProvider } from "@/lib/ai";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { isGmailConfigured } from "@/lib/gmail";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import type { IntegrationStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status: IntegrationStatus = {
    brain: isAIConfigured(),
    brainProvider: getAIProvider(),
    elevenlabs: isElevenLabsConfigured(),
    gmail: isGmailConfigured(),
    whatsapp: isWhatsAppConfigured(),
  };
  return NextResponse.json(status);
}
