import { NextRequest, NextResponse } from "next/server";
import {
  isEmail,
  missingDetails,
  orderReference,
  priceCart,
  sanitiseBuyer,
  sanitiseCart,
  type CartLine,
  type PlacedOrder,
} from "@/lib/shop/order";
import { TERMS } from "@/lib/shop/brand";
import { moneyRound } from "@/lib/shop/format";
import { pushToList, readJson, readList, storageMode, writeJson } from "@/lib/shop/store";
import { attachBuyerCookie, buyerId, cartKey, isSignedIn, ordersKey } from "@/lib/shop/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorised = () =>
  NextResponse.json({ error: "Sign in to the trade portal first." }, { status: 401 });

/** Everything this buyer has ordered, newest first. Read from the cloud store. */
export async function GET(req: NextRequest) {
  if (!isSignedIn(req)) return unauthorised();

  const buyer = buyerId(req);
  const raw = await readList(ordersKey(buyer.id));
  const orders = raw
    .map((entry) => {
      try {
        return JSON.parse(entry) as PlacedOrder;
      } catch {
        return null;
      }
    })
    .filter((order): order is PlacedOrder => order !== null);

  return attachBuyerCookie(
    NextResponse.json({ orders, storedIn: storageMode() }),
    req,
    buyer
  );
}

/**
 * Place the order.
 *
 * The cart is read back out of the cloud store rather than taken from the
 * request, and repriced here. A purchase order priced by the browser is a
 * purchase order priced by whoever opened the console.
 */
export async function POST(req: NextRequest) {
  if (!isSignedIn(req)) return unauthorised();

  let body: { buyer?: unknown; cart?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const buyer = buyerId(req);
  const stored = await readJson<CartLine[]>(cartKey(buyer.id));
  const cart = sanitiseCart(stored?.length ? stored : body.cart);

  if (cart.length === 0) {
    return NextResponse.json({ error: "Your order is empty." }, { status: 400 });
  }

  const details = sanitiseBuyer(body.buyer);
  const missing = missingDetails(details);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Some account details are missing.", missing },
      { status: 400 }
    );
  }
  if (!isEmail(details.email)) {
    return NextResponse.json(
      { error: "That email address doesn't look right.", missing: ["email"] },
      { status: 400 }
    );
  }

  const totals = priceCart(cart);
  if (!totals.meetsMinimum) {
    return NextResponse.json(
      { error: `Orders start at ${moneyRound(TERMS.minimumOrder)} of goods.` },
      { status: 400 }
    );
  }

  const order: PlacedOrder = {
    reference: orderReference(),
    placedAt: new Date().toISOString(),
    buyer: details,
    lines: totals.lines.map((line) => ({
      sku: line.product.sku,
      name: line.product.name,
      quantity: line.quantity,
      unit: line.unit,
      net: line.net,
    })),
    goods: totals.goods,
    shipping: totals.shipping,
    total: totals.total,
    retailValue: totals.retailValue,
    profit: totals.profit,
    unitCount: totals.unitCount,
    storedIn: storageMode(),
  };

  try {
    await pushToList(ordersKey(buyer.id), JSON.stringify(order));
    // The cart has become an order; it should not still be a cart.
    await writeJson(cartKey(buyer.id), []);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `The order could not be filed: ${err.message}`
            : "The order could not be filed.",
      },
      { status: 502 }
    );
  }

  return attachBuyerCookie(NextResponse.json({ ok: true, order }), req, buyer);
}
