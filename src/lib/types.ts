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
  /**
   * A panel the browser should open in response to this action. Tools run on
   * the server, so this is how one asks the interface to do something.
   */
  opens?: "hologram";
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
  brainProvider: "openai" | "gemini" | "openrouter" | null;
  elevenlabs: boolean;
  /** Whether the server can transcribe recorded audio (mic works everywhere). */
  transcription: boolean;
  gmail: boolean;
  /** Client ID/secret present — the step before authorizing. */
  gmailCredentials: boolean;
  /** The redirect URI that must be registered in the Google OAuth client. */
  gmailRedirectUri: string;
  whatsapp: boolean;
  /** Whether JARVIS may open or close apps on this machine. */
  desktopControl: boolean;
  /** Whether a YouTube key is available for channel statistics. */
  youtube: boolean;
  /** The channel reported on by default, if one is set. */
  youtubeChannel: string | null;
  /** The folders JARVIS is allowed to search, by label. */
  fileRoots: string[];
  /** How many things he currently remembers about you. */
  memories: number;
  /** How many days of session history are on disk. */
  sessionDays: number;
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
