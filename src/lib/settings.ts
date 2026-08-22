import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";

// Runtime settings layered on top of .env.local. Everything Axis needs can
// be typed into the Settings panel instead of hand-editing an env file, which
// is the difference between "works" and "doesn't" for most people. Values live
// in data/settings.json (gitignored, same place as the Gmail token) and take
// precedence over the matching environment variable, since a key you just
// typed is a more current statement of intent than a stale .env.local line.

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

export const SETTING_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_REASONING_EFFORT",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_EFFORT",
  "MAX_TOKENS",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_WHATSAPP_TO_DEFAULT",
  "TWILIO_VOICE_FROM",
  "MY_PHONE_NUMBER",
  "PHONE_CONTACTS",
  "PHONE_COUNTRY_CODE",
  "ZAPIER_HOOKS",
  "GOOGLE_SEARCH_KEY",
  "GOOGLE_SEARCH_CX",
  "YOUTUBE_API_KEY",
  "YOUTUBE_CHANNEL",
  "DESKTOP_CONTROL",
  "FILE_SEARCH_ROOTS",
  "DOCUMENTS_FOLDER",
  "USER_TITLE",
  "HUMOUR",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// Keys whose value must never be echoed back to the browser — only a
// "•••• last4" hint. The rest (model names, phone numbers) are safe to show.
const SECRET_KEYS = new Set<SettingKey>([
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "TWILIO_AUTH_TOKEN",
  "YOUTUBE_API_KEY",
  "GOOGLE_SEARCH_KEY",
]);

export function isSecretKey(key: SettingKey): boolean {
  return SECRET_KEYS.has(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

type SettingsFile = Partial<Record<SettingKey, string>>;

// Cached so the hot path (every chat request reads several keys) isn't a disk
// hit, but keyed on mtime so an external edit to the file is still picked up.
let cache: SettingsFile = {};
let cacheMtimeMs: number | null = null;

function load(): SettingsFile {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(SETTINGS_PATH).mtimeMs;
  } catch {
    cache = {};
    cacheMtimeMs = null;
    return cache;
  }

  if (cacheMtimeMs === mtimeMs) return cache;

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    const next: SettingsFile = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isSettingKey(key) && typeof value === "string") next[key] = value;
      }
    }
    cache = next;
  } catch {
    // A corrupt settings file shouldn't take the whole app down — fall back to
    // environment variables until it's overwritten by the next save.
    cache = {};
  }
  cacheMtimeMs = mtimeMs;
  return cache;
}

/** Saved value if present, otherwise the environment variable. */
export function getSetting(key: SettingKey): string | undefined {
  const saved = load()[key]?.trim();
  if (saved) return saved;
  const fromEnv = process.env[key]?.trim();
  return fromEnv || undefined;
}

/** Where a value came from — used to explain overrides in the UI. */
export function settingSource(key: SettingKey): "saved" | "env" | "unset" {
  if (load()[key]?.trim()) return "saved";
  if (process.env[key]?.trim()) return "env";
  return "unset";
}

/**
 * Merge values into data/settings.json. An empty string clears the saved value
 * so the environment variable (if any) takes over again.
 */
export function saveSettings(updates: Partial<Record<SettingKey, string>>): void {
  const next: SettingsFile = { ...load() };

  for (const [key, rawValue] of Object.entries(updates)) {
    if (!isSettingKey(key)) continue;
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
  }

  // 0600: this file holds API keys, so keep it readable only by its owner.
  writeFileAtomic(SETTINGS_PATH, JSON.stringify(next, null, 2));

  cache = next;
  try {
    cacheMtimeMs = fs.statSync(SETTINGS_PATH).mtimeMs;
  } catch {
    cacheMtimeMs = null;
  }
}

/** A non-reversible preview of a value, for display in the Settings panel. */
export function maskValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
