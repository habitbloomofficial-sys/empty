import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  MIN_LENGTH,
  clearPasscode,
  setPasscode,
  SESSION_DAYS,
  checkPasscode,
  clearFailures,
  isPasscodeSet,
  issueToken,
  recordFailure,
  throttle,
} from "@/lib/passcode";
import { clientAddress, requestZone } from "@/lib/network";

export const runtime = "nodejs";

/** Whether this caller needs to unlock, and whether there is a lock to open. */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    passcodeSet: isPasscodeSet(),
    zone: requestZone(req.headers),
  });
}

export async function POST(req: NextRequest) {
  let body: { passcode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.passcode !== "string" || !body.passcode) {
    return NextResponse.json({ error: "A passcode is required." }, { status: 400 });
  }

  if (!isPasscodeSet()) {
    return NextResponse.json(
      { error: "No passcode has been set on the computer Axis runs on.", reason: "no-passcode" },
      { status: 503 }
    );
  }

  // Per address, so somebody guessing from one place cannot lock you out from
  // another.
  const key = clientAddress(req.headers) ?? "unknown";
  const { allowed, waitMs } = throttle(key);
  if (!allowed) {
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429 }
    );
  }

  if (!checkPasscode(body.passcode)) {
    recordFailure(key);
    return NextResponse.json({ error: "That isn't the passcode." }, { status: 401 });
  }

  clearFailures(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Remote access is HTTPS by definition — a tunnel terminates TLS for us —
    // but on a plain-http LAN a Secure cookie would simply never be stored.
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}

/**
 * Set or change the passcode.
 *
 * Only from the computer itself or your own network — never from the internet.
 * Allowing it from outside would mean that the moment Axis is reachable and has
 * no passcode, the first stranger to find him could set one and lock you out of
 * your own machine. The one thing a public caller may do is answer a passcode
 * that already exists.
 */
export async function PUT(req: NextRequest) {
  if (requestZone(req.headers) === "public") {
    return NextResponse.json(
      { error: "A passcode can only be set from the computer Axis runs on." },
      { status: 403 }
    );
  }

  let body: { passcode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // An empty passcode removes it, which also shuts the door on remote access
  // rather than leaving it open.
  if (body.passcode === "" || body.passcode === null) {
    clearPasscode();
    return NextResponse.json({ ok: true, passcodeSet: false });
  }

  if (typeof body.passcode !== "string") {
    return NextResponse.json(
      { error: `A passcode of at least ${MIN_LENGTH} characters is required.` },
      { status: 400 }
    );
  }

  try {
    setPasscode(body.passcode);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, passcodeSet: true });
}

/** Sign this device out. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
