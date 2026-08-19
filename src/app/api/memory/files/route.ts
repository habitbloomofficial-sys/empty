import { NextRequest, NextResponse } from "next/server";
import {
  ensureMemoryFiles,
  readNotes,
  readSession,
  readUserProfile,
  writeNotes,
  writeUserProfile,
} from "@/lib/sessions";

export const runtime = "nodejs";

// The editable layers, so the files can be read and changed from the panel as
// well as from Notepad. Only these two: facts have their own list, and session
// logs are a record — editing history to say something that didn't happen is
// the one thing that would make the whole system worthless.

const LAYERS = ["user", "notes"] as const;
type Layer = (typeof LAYERS)[number];

function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  ensureMemoryFiles();

  const session = req.nextUrl.searchParams.get("session");
  if (session) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) {
      return NextResponse.json({ error: "Not a session date." }, { status: 400 });
    }
    return NextResponse.json({ session: readSession(session) });
  }

  return NextResponse.json({ user: readUserProfile(), notes: readNotes() });
}

export async function PUT(req: NextRequest) {
  let body: { layer?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.layer !== "string" || !isLayer(body.layer)) {
    return NextResponse.json(
      { error: `layer must be one of: ${LAYERS.join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "text must be a string" }, { status: 400 });
  }
  // Generous, but not unbounded: these are read into every prompt.
  if (body.text.length > 20_000) {
    return NextResponse.json({ error: "That's too long to keep as a memory file." }, { status: 400 });
  }

  if (body.layer === "user") writeUserProfile(body.text);
  else writeNotes(body.text);

  return NextResponse.json({ ok: true, user: readUserProfile(), notes: readNotes() });
}
