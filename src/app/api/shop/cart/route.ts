import { NextRequest, NextResponse } from "next/server";
import { priceCart, sanitiseCart, type CartLine } from "@/lib/shop/order";
import { readJson, storageMode, writeJson } from "@/lib/shop/store";
import { attachBuyerCookie, buyerId, cartKey, isSignedIn } from "@/lib/shop/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The cart lives in the cloud store, not in the browser and not on disk.
 *
 * The browser keeps its own copy so clicking is instant, but this is the copy
 * that counts: it follows the buyer between devices and it is the one the
 * purchase order is priced from.
 */

const unauthorised = () =>
  NextResponse.json({ error: "Sign in to the trade portal first." }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!isSignedIn(req)) return unauthorised();

  const buyer = buyerId(req);
  const stored = await readJson<CartLine[]>(cartKey(buyer.id));
  const cart = sanitiseCart(stored ?? []);
  const priced = priceCart(cart);

  return attachBuyerCookie(
    NextResponse.json({ cart, totals: summary(priced), storedIn: storageMode() }),
    req,
    buyer
  );
}

export async function PUT(req: NextRequest) {
  if (!isSignedIn(req)) return unauthorised();

  let body: { cart?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const buyer = buyerId(req);
  const cart = sanitiseCart(body.cart);

  try {
    await writeJson(cartKey(buyer.id), cart);
  } catch (err) {
    // A cart that failed to reach the cloud is still a usable cart in the tab;
    // say so rather than pretending it saved.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach the cloud store.", cart },
      { status: 502 }
    );
  }

  return attachBuyerCookie(
    NextResponse.json({ cart, totals: summary(priceCart(cart)), storedIn: storageMode() }),
    req,
    buyer
  );
}

/** The client prices its own cart; it only needs the server's arithmetic to
 *  check against, so send numbers rather than the whole product records. */
function summary(totals: ReturnType<typeof priceCart>) {
  const { lines, ...rest } = totals;
  return { ...rest, lineCount: lines.length };
}
