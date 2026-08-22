import { NextRequest, NextResponse } from "next/server";
import { describeDevice, isLoopback } from "@/lib/device";
import { isAIConfigured, getAIProvider } from "@/lib/ai";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import {
  areGmailCredentialsConfigured,
  isCalendarConfigured,
  isGmailConfigured,
  redirectUri,
} from "@/lib/gmail";
import { isPhoneConfigured, savedContacts } from "@/lib/phone";
import { savedZaps } from "@/lib/zapier";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isTranscriptionConfigured } from "@/lib/transcription";
import { isDesktopControlEnabled } from "@/lib/desktop";
import { configuredChannel, isYouTubeConfigured } from "@/lib/youtube";
import { isFileSearchEnabled, searchRoots } from "@/lib/files";
import { memoryCount } from "@/lib/memory";
import { listSessionDates } from "@/lib/sessions";
import { humour, userTitle } from "@/lib/address";
import type { IntegrationStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const local = !forwarded || isLoopback(forwarded.split(",")[0]);
  const device = describeDevice(req.headers.get("user-agent"), local);

  const status: IntegrationStatus = {
    brain: isAIConfigured(),
    brainProvider: getAIProvider(),
    elevenlabs: isElevenLabsConfigured(),
    transcription: isTranscriptionConfigured(),
    gmail: isGmailConfigured(),
    gmailCredentials: areGmailCredentialsConfigured(),
    gmailRedirectUri: redirectUri(),
    whatsapp: isWhatsAppConfigured(),
    phone: isPhoneConfigured(),
    phoneContacts: isPhoneConfigured() ? savedContacts().map((c) => c.name) : [],
    calendar: isCalendarConfigured(),
    zaps: savedZaps().map((zap) => zap.name),
    desktopControl: isDesktopControlEnabled(),
    youtube: isYouTubeConfigured(),
    youtubeChannel: configuredChannel() ?? null,
    fileRoots: isFileSearchEnabled() ? searchRoots().map((root) => root.label) : [],
    device,
    memories: memoryCount(),
    sessionDays: listSessionDates().length,
    title: userTitle(),
    humour: humour(),
  };
  return NextResponse.json(status);
}
