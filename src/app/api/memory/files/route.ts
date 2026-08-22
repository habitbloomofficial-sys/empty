import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/memory";
import { writeFileAtomic } from "@/lib/atomicWrite";
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
// well as from Notepad. Only these three: facts have their own list, and session
// logs are a record — editing history to say something that didn't happen is
// the one thing that would make the whole system worthless.
//
// What he has learned is editable for the opposite reason. He now picks things
// up off the web on his own, and anything picked up that way can be wrong; a
// belief you cannot correct is worse than one he never formed.

const LAYERS = ["user", "notes", "learned"] as const;

const LEARNED_PATH = path.join(MEMORY_DIR, "LEARNED.md");

function readLearnedFile(): string {
  try {
    return fs.readFileSync(LEARNED_PATH, "utf-8");
  } catch {
    return "";
  }
}

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

  return NextResponse.json({
    user: readUserProfile(),
    notes: readNotes(),
    learned: readLearnedFile(),
  });
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
  else if (body.layer === "notes") writeNotes(body.text);
  else writeFileAtomic(LEARNED_PATH, body.text);

  return NextResponse.json({
    ok: true,
    user: readUserProfile(),
    notes: readNotes(),
    learned: readLearnedFile(),
  });
}
