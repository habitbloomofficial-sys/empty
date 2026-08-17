export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  actions?: ActionLogEntry[];
}

export interface ActionLogEntry {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface IntegrationStatus {
  brain: boolean;
  brainProvider: "openai" | "gemini" | null;
  elevenlabs: boolean;
  gmail: boolean;
  whatsapp: boolean;
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
