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
  /** A model file the projector should open onto, rather than an empty stage. */
  model?: string;
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
  brainProvider: "openai" | "gemini" | "openrouter" | "anthropic" | null;
  elevenlabs: boolean;
  /** Whether the server can transcribe recorded audio (mic works everywhere). */
  transcription: boolean;
  gmail: boolean;
  /** Client ID/secret present — the step before authorizing. */
  gmailCredentials: boolean;
  /** The redirect URI that must be registered in the Google OAuth client. */
  gmailRedirectUri: string;
  whatsapp: boolean;
  /** Whether Axis can place a call and connect you to it. */
  phone: boolean;
  /** Names you can ask him to call. */
  phoneContacts: string[];
  /** Whether the Google connection includes the calendar. */
  calendar: boolean;
  /** Named Zapier automations Axis can fire. */
  zaps: string[];
  /** Whether Axis may open or close apps on this machine. */
  desktopControl: boolean;
  /** A Honcho key is saved. Stored only — see the Settings panel. */
  honcho: boolean;
  /** He may make thumbnails, which cost money per picture. */
  thumbnails: boolean;
  /** He may speak without being spoken to. */
  idleTalk: boolean;
  /**
   * The language tag the browser should listen in. Not the browser's own
   * setting — see speechLang.ts for why that one breaks the wake word.
   */
  speechLang: string;
  /** How he searches the web, if he can — usually through the brain he runs on. */
  webSearch: "google" | "gemini" | "openrouter" | "anthropic" | null;
  /** Whether a passcode exists, which is what makes remote access possible. */
  passcodeSet: boolean;
  /** Where this request came from: his own machine, your network, or the internet. */
  zone: "loopback" | "private" | "public";
  /** How many things he has learned and kept. */
  learned: number;
  /** Whether a YouTube key is available for channel statistics. */
  youtube: boolean;
  /** The channel reported on by default, if one is set. */
  youtubeChannel: string | null;
  /** The folders Axis is allowed to search, by label. */
  fileRoots: string[];
  /** Which of your machines you're reading this on. */
  device: { kind: "phone" | "tablet" | "computer"; label: string; remote: boolean };
  /** How many things he currently remembers about you. */
  memories: number;
  /** How many days of session history are on disk. */
  sessionDays: number;
  /** What he calls you. */
  title: string;
  /** How funny he's allowed to be. */
  humour: "dry" | "playful" | "off";
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
