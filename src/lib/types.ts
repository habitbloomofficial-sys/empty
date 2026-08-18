export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  actions?: ActionLogEntry[];
  timings?: ReplyTimings;
}

export interface ActionLogEntry {
  tool: string;
  summary: string;
  ok: boolean;
}

/** Per-stage latency in milliseconds, so slowness can be located, not guessed. */
export interface ReplyTimings {
  transcribe?: number;
  model?: number;
  tools?: number;
  /** Time from sending the reply to TTS until the first audio plays. */
  speak?: number;
  total?: number;
}

export interface IntegrationStatus {
  brain: boolean;
  brainProvider: "openai" | "gemini" | null;
  elevenlabs: boolean;
  /** Whether the server can transcribe recorded audio (mic works everywhere). */
  transcription: boolean;
  gmail: boolean;
  /** Client ID/secret present — the step before authorizing. */
  gmailCredentials: boolean;
  /** The redirect URI that must be registered in the Google OAuth client. */
  gmailRedirectUri: string;
  whatsapp: boolean;
  /** Whether JARVIS may open desktop apps (Spotify) on this machine. */
  desktopControl: boolean;
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
