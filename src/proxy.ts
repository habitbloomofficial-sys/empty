import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, isPasscodeSet, isValidToken } from "@/lib/passcode";
import { requestZone } from "@/lib/network";

// The front door, and the only one.
//
// Next calls this file the "proxy" — it is what used to be called middleware,
// and it is the one place every request passes through before anything else
// runs.
//
// Every request to Axis passes through here — pages and API routes alike —
// because a lock on the page with the API left open is not a lock. Written once
// in this file rather than repeated at the top of eighteen route handlers,
// where the nineteenth would be the one that got forgotten.
//
// The rule:
//
//   from this computer, or from your own network  →  through, as always
//   from the internet                             →  passcode, no exceptions
//
// The second case is not a preference. Axis reads email, places calls, fires
// automations and opens things on your desktop; reachable from the internet
// without a passcode, he is a remote control for your life that anyone who
// finds the address may pick up.

// Everything static is excluded here rather than in code: those are pictures
// and a stylesheet, and gating them buys nothing. (The runtime is always Node,
// which is what lets the passcode be checked against a file on disk.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|offline.html).*)"],
};

/** Reachable while locked, because they are how you unlock. */
function isUnlockPath(pathname: string): boolean {
  return pathname === "/unlock" || pathname === "/api/auth";
}

export default function proxy(req: NextRequest) {
  const zone = requestZone(req.headers);
  if (zone !== "public") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isUnlockPath(pathname)) return NextResponse.next();

  // Reached from the internet with no passcode ever set. Rather than let that
  // through, or lock him out of his own machine, say exactly what is missing.
  if (!isPasscodeSet()) {
    return refuse(
      req,
      "no-passcode",
      "Axis is reachable from the internet but has no passcode set. " +
        "Set one on the computer he runs on — Settings, under Remote access — " +
        "and this page will let you in.",
      503
    );
  }

  if (isValidToken(req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();

  return refuse(req, "locked", "Axis is locked.", 401);
}

/**
 * A page gets the lock screen; an API call gets a status code.
 *
 * The distinction matters: the browser is fetching in the background half the
 * time, and answering those with HTML produces a parse error rather than
 * anything anyone can act on.
 */
function refuse(req: NextRequest, reason: string, message: string, status: number) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message, reason }, { status });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = reason === "no-passcode" ? "?reason=no-passcode" : "";
  const response = NextResponse.rewrite(url);
  response.headers.set("x-axis-lock", reason);
  return response;
}
