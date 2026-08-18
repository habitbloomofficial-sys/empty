import { NextRequest, NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, saveTokenFromCode } from "@/lib/gmail";

export const runtime = "nodejs";

// Google's own error codes, which are far more useful than "something failed"
// once you know what they mean.
const GOOGLE_ERRORS: Record<string, string> = {
  access_denied:
    "You declined the permission request — Gmail can't be connected without it.",
  redirect_uri_mismatch:
    "The redirect URI in your Google OAuth client doesn't match this app's. Add it exactly as shown in Settings.",
  invalid_client: "Google didn't recognise the client ID or secret. Check them in Settings.",
  admin_policy_enforced:
    "Your Google Workspace admin blocks this app from accessing Gmail.",
  org_internal:
    "That OAuth client is limited to one organisation, and this account isn't in it.",
};

function fail(origin: string, reason: string) {
  return NextResponse.redirect(
    `${origin}/?gmail=error&reason=${encodeURIComponent(reason)}`
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const origin = req.nextUrl.origin;

  const googleError = params.get("error");
  if (googleError) {
    return fail(origin, GOOGLE_ERRORS[googleError] ?? `Google reported: ${googleError}`);
  }

  const code = params.get("code");
  if (!code) {
    return fail(origin, "Google didn't send an authorization code back.");
  }

  // The state must match the cookie set when the flow started.
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const receivedState = params.get("state");
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return fail(
      origin,
      "That sign-in didn't start from this app, so it was rejected. Try Connect Gmail again."
    );
  }

  try {
    await saveTokenFromCode(code);
    const response = NextResponse.redirect(`${origin}/?gmail=connected`);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const matched = Object.keys(GOOGLE_ERRORS).find((key) => raw.includes(key));
    return fail(origin, matched ? GOOGLE_ERRORS[matched] : raw);
  }
}
