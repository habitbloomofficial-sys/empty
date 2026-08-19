import { NextResponse } from "next/server";
import { defaultVoiceId, listVoices, isElevenLabsConfigured } from "@/lib/elevenlabs";

export const runtime = "nodejs";

/**
 * The voices this account can actually speak with.
 *
 * Settings offers this as a list rather than a text box, because a voice id is
 * unguessable and un-checkable by eye — and a wrong one fails silently, with
 * speech quietly falling back to the browser's built-in robot.
 */
export async function GET() {
  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ voices: [], selected: null });
  }
  try {
    const voices = await listVoices();
    return NextResponse.json({
      selected: defaultVoiceId(),
      voices: voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category ?? null })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 200 with an explanation: an unreachable list shouldn't read to the panel
    // as a broken app, and the id box beneath it still works.
    return NextResponse.json({ error: message, voices: [], selected: null });
  }
}
