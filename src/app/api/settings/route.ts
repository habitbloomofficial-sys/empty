import { NextRequest, NextResponse } from "next/server";
import {
  SETTING_KEYS,
  getSetting,
  isSecretKey,
  isSettingKey,
  maskValue,
  saveSettings,
  settingSource,
  type SettingKey,
} from "@/lib/settings";
import { isVerifiableKey, verifyKey, type KeyCheck } from "@/lib/verify";
import { normalizeVoiceId } from "@/lib/voiceId";

/**
 * Tidy a value before it's stored. Only the voice id needs it so far: people
 * paste share links and labelled lines, and every one of those is a clear
 * statement of which voice they want.
 */
function clean(key: SettingKey, value: string): string {
  if (key === "ELEVENLABS_VOICE_ID" && value.trim()) {
    return normalizeVoiceId(value) || value.trim();
  }
  return value;
}

export const runtime = "nodejs";

export interface SettingView {
  key: SettingKey;
  set: boolean;
  secret: boolean;
  /** Masked for secrets, plain for non-sensitive values like model names. */
  display: string;
  source: "saved" | "env" | "unset";
}

function view(key: SettingKey): SettingView {
  const value = getSetting(key);
  const secret = isSecretKey(key);
  return {
    key,
    set: Boolean(value),
    secret,
    display: value ? (secret ? maskValue(value) : value) : "",
    source: settingSource(key),
  };
}

export async function GET() {
  // Never returns a raw secret — only whether it's set and a masked hint.
  return NextResponse.json({ settings: SETTING_KEYS.map(view) });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected an object of settings" }, { status: 400 });
  }

  const updates: Partial<Record<SettingKey, string>> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!isSettingKey(key)) {
      rejected.push(key);
      continue;
    }
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: `Setting "${key}" must be a string.` },
        { status: 400 }
      );
    }
    updates[key] = clean(key, value);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        error: rejected.length
          ? `Unknown setting(s): ${rejected.join(", ")}`
          : "No settings provided.",
      },
      { status: 400 }
    );
  }

  try {
    saveSettings(updates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Couldn't save settings: ${message}` },
      { status: 500 }
    );
  }

  // The value is saved either way — verification is advice, not a gate, so a
  // provider outage never blocks you from storing a key you know is right.
  const checks = (
    await Promise.all(
      Object.entries(updates)
        .filter(([key, value]) => isSettingKey(key) && isVerifiableKey(key) && value.trim())
        .map(([key, value]) => verifyKey(key as SettingKey, value))
    )
  ).filter((check): check is KeyCheck => check !== null);

  return NextResponse.json({ ok: true, settings: SETTING_KEYS.map(view), checks });
}
