import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/gmail";

export const runtime = "nodejs";

export async function GET() {
  try {
    const url = getAuthUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
