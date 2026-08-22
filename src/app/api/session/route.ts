import { NextRequest, NextResponse } from "next/server";
import { describeDevice, isLoopback } from "@/lib/device";
import {
  ensureMemoryFiles,
  listSessionDates,
  markSession,
  readSession,
  sessionKey,
  startSession,
} from "@/lib/sessions";

export const runtime = "nodejs";

/** Today's log and the dates of everything kept. */
export async function GET() {
  ensureMemoryFiles();
  const date = sessionKey();
  return NextResponse.json({
    date,
    today: readSession(date),
    dates: listSessionDates(),
  });
}

/**
 * The `/start` ritual, and the two markers that make resuming meaningful.
 *
 * "open" is called when the interface loads: it works out whether this is a
 * new day, a session being picked up, or one that stopped without saying so,
 * and returns a line for Axis to say. "pause" is sent when the page is
 * closed — best-effort, via sendBeacon — and "close" is signing off for the
 * day. A session with no marker at all is how an interruption is recognised.
 */
export async function POST(req: NextRequest) {
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "open";
  ensureMemoryFiles();

  try {
    if (action === "open") {
      // Which machine he is on. The address says whether it is this one; the
      // user agent says what kind of thing it is.
      const local = isLoopback(
        req.headers.get("x-forwarded-for")?.split(",")[0] ?? null
      ) || !req.headers.get("x-forwarded-for");
      const device = describeDevice(req.headers.get("user-agent"), local);

      const briefing = startSession(new Date(), device.label);
      return NextResponse.json({ ...briefing, device });
    }
    if (action === "pause" || action === "close") {
      const session = markSession(action === "pause" ? "paused" : "closed");
      return NextResponse.json({ ok: true, session });
    }
    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
