import { NextRequest, NextResponse } from "next/server";
import { isTranscriptionConfigured, transcribeAudio } from "@/lib/transcription";

export const runtime = "nodejs";

// Roughly a minute of Opus audio. Guards against a runaway recording being
// uploaded and billed as one enormous transcription request.
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!isTranscriptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "No transcription service configured, sir — add an ElevenLabs or OpenAI API key in Settings.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "No audio was uploaded." }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "The recording was empty." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "That recording is too long." }, { status: 413 });
  }

  const filename =
    audio instanceof File && audio.name ? audio.name : "speech.webm";

  try {
    const text = await transcribeAudio(audio, filename);
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
