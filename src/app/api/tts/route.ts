import { NextRequest, NextResponse } from "next/server";
import { textToSpeechStream } from "@/lib/elevenlabs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { text?: string; voiceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    // Piped straight through rather than buffered here — the browser can start
    // playing while ElevenLabs is still generating the rest.
    const stream = await textToSpeechStream(text, body.voiceId);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        // Nothing between here and the browser should sit on the chunks.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
