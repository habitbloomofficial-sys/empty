import { NextResponse } from "next/server";
import { listVoices, isElevenLabsConfigured } from "@/lib/elevenlabs";

export const runtime = "nodejs";

export async function GET() {
  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ voices: [] });
  }
  try {
    const voices = await listVoices();
    return NextResponse.json({
      voices: voices.map((v) => ({ id: v.voice_id, name: v.name })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, voices: [] }, { status: 502 });
  }
}
