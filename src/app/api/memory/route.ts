import { NextRequest, NextResponse } from "next/server";
import { forget, forgetAll, listMemories, remember } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ memories: listMemories() });
}

export async function POST(req: NextRequest) {
  let body: { fact?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.fact !== "string") {
    return NextResponse.json({ error: "fact must be a string" }, { status: 400 });
  }

  try {
    const { memory, wasAlreadyKnown } = remember(body.fact);
    return NextResponse.json({ memory, wasAlreadyKnown, memories: listMemories() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  // No id means clear everything — an explicit choice in the Settings panel,
  // never something a conversation can trigger.
  if (!id) {
    const cleared = forgetAll();
    return NextResponse.json({ cleared, memories: [] });
  }

  const removed = forget(id);
  return NextResponse.json({ removed, memories: listMemories() });
}
