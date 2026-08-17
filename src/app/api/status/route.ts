import { NextResponse } from "next/server";
import { isOpenAIConfigured } from "@/lib/openai";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { isGmailConfigured } from "@/lib/gmail";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import type { IntegrationStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status: IntegrationStatus = {
    openai: isOpenAIConfigured(),
    elevenlabs: isElevenLabsConfigured(),
    gmail: isGmailConfigured(),
    whatsapp: isWhatsAppConfigured(),
  };
  return NextResponse.json(status);
}
