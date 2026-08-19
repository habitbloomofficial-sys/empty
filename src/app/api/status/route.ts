import { NextResponse } from "next/server";
import { isAIConfigured, getAIProvider } from "@/lib/ai";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { areGmailCredentialsConfigured, isGmailConfigured, redirectUri } from "@/lib/gmail";
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
    desktopControl: isDesktopControlEnabled(),
    youtube: isYouTubeConfigured(),
    youtubeChannel: configuredChannel() ?? null,
    fileRoots: isFileSearchEnabled() ? searchRoots().map((root) => root.label) : [],
    memories: memoryCount(),
    sessionDays: listSessionDates().length,
    title: userTitle(),
    humour: humour(),
  };
  return NextResponse.json(status);
}
