import { NextResponse } from "next/server";
import { disconnectGmail } from "@/lib/gmail";

export const runtime = "nodejs";

// Forgetting the stored token is also the fix for a half-granted connection:
// scopes are fixed at consent time, so re-running the flow is the only way to
// pick up permissions that were declined the first time.
export async function POST() {
  try {
    disconnectGmail();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
