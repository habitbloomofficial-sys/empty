import { NextRequest, NextResponse } from "next/server";
import { readJson, storageMode, writeJson } from "@/lib/shop/store";
import { attachBuyerCookie, buyerId, isSignedIn } from "@/lib/shop/session";
import { prefsKey, type Prefs } from "@/lib/shop/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The handful of things the portal remembers about a buyer that aren't an
 * order — right now, only whether they have already sat through the
 * introduction. It lives in the cloud store with everything else rather than
 * in this browser, so a buyer who has seen it once has seen it on every
 * machine they sign in from.
 */

export async function PUT(req: NextRequest) {
  if (!isSignedIn(req)) {
    return NextResponse.json({ error: "Sign in to the trade portal first." }, { status: 401 });
  }

  let body: { introSeen?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const buyer = buyerId(req);
  const prefs: Prefs = { introSeen: body.introSeen === true };

  try {
    await writeJson(prefsKey(buyer.id), prefs);
  } catch {
    // Forgetting a preference is not worth failing a page over.
    return NextResponse.json({ ok: false, prefs }, { status: 200 });
  }

  return attachBuyerCookie(NextResponse.json({ ok: true, prefs, storedIn: storageMode() }), req, buyer);
}

export async function GET(req: NextRequest) {
  if (!isSignedIn(req)) {
    return NextResponse.json({ error: "Sign in to the trade portal first." }, { status: 401 });
  }
  const buyer = buyerId(req);
  const prefs = (await readJson<Prefs>(prefsKey(buyer.id))) ?? { introSeen: false };
  return attachBuyerCookie(NextResponse.json({ prefs, storedIn: storageMode() }), req, buyer);
}
