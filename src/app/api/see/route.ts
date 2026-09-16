import { NextResponse } from "next/server";
import { isImageType, look, MAX_IMAGE_BYTES } from "@/lib/vision";

export const runtime = "nodejs";

// One frame, one question, one answer. See vision.ts for why nothing here
// keeps the picture.

export async function POST(request: Request) {
  let body: { image?: unknown; mediaType?: unknown; question?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "That wasn't a picture I could read, sir." }, { status: 400 });
  }

  const image = typeof body.image === "string" ? body.image.replace(/^data:[^,]+,/, "") : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "image/jpeg";
  const question = typeof body.question === "string" ? body.question : undefined;

  if (!image) {
    return NextResponse.json({ error: "There's no picture there, sir." }, { status: 400 });
  }
  if (!isImageType(mediaType)) {
    return NextResponse.json({ error: `I can't read ${mediaType}, sir.` }, { status: 400 });
  }
  if (Math.floor((image.length * 3) / 4) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "That picture is too large to send, sir." }, { status: 413 });
  }

  try {
    const result = await look({ imageBase64: image, mediaType, question });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The camera didn't work out, sir.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
