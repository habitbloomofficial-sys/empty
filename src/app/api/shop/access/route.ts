import { NextRequest, NextResponse } from "next/server";
import { clientAddress } from "@/lib/network";
import {
  COOKIE_NAME,
  SESSION_HOURS,
  attemptsLeft,
  checkCode,
  clearFailures,
  issueToken,
  recordFailure,
  throttle,
} from "@/lib/shop/access";

export const runtime = "nodejs";

/** Answer the access code. Right code in, signed session cookie out. */
export async function POST(req: NextRequest) {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body.code !== "string" || !body.code.trim()) {
    return NextResponse.json({ error: "Enter your access code." }, { status: 400 });
  }

  // Per address, so one buyer fat-fingering their code cannot lock out another.
  const key = clientAddress(req.headers) ?? "unknown";
  const { allowed, waitMs } = throttle(key);
  if (!allowed) {
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or contact your account manager.`,
        left: 0,
      },
      { status: 429 }
    );
  }

  if (!checkCode(body.code)) {
    recordFailure(key);
    return NextResponse.json(
      { error: "That code is not recognised. Access is by invitation only.", left: attemptsLeft(key) },
      { status: 401 }
    );
  }

  clearFailures(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
  return response;
}

/** Sign out of the trade portal. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
