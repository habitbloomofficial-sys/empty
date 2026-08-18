import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, newOAuthState, OAUTH_STATE_COOKIE } from "@/lib/gmail";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    // A one-time value echoed back by Google and checked in the callback, so
    // the callback can't be driven by a link someone else crafted.
    const state = newOAuthState();
    const response = NextResponse.redirect(getAuthUrl(state));
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: req.nextUrl.protocol === "https:",
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${req.nextUrl.origin}/?gmail=error&reason=${encodeURIComponent(message)}`
    );
  }
}
