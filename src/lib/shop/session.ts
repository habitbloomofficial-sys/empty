import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, isValidToken } from "./access";

/*
 * Who is asking, and are they allowed to.
 *
 * Two cookies do two different jobs. The trade cookie says the access code was
 * answered correctly and expires with the session. The buyer cookie is a random
 * id with no authority at all — it only says which cart in the cloud store
 * belongs to this browser, so a cart survives signing out and back in.
 */

export const BUYER_COOKIE = "aurea_buyer";
const BUYER_MAX_AGE = 60 * 60 * 24 * 180;

export function isSignedIn(req: NextRequest): boolean {
  return isValidToken(req.cookies.get(COOKIE_NAME)?.value);
}

/** The buyer id on this request, or a fresh one to be set on the response. */
export function buyerId(req: NextRequest): { id: string; isNew: boolean } {
  const existing = req.cookies.get(BUYER_COOKIE)?.value;
  if (existing && /^[a-z0-9]{16,64}$/i.test(existing)) return { id: existing, isNew: false };
  return { id: crypto.randomBytes(16).toString("hex"), isNew: true };
}

export function attachBuyerCookie(
  response: NextResponse,
  req: NextRequest,
  buyer: { id: string; isNew: boolean }
): NextResponse {
  if (!buyer.isNew) return response;
  response.cookies.set(BUYER_COOKIE, buyer.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: BUYER_MAX_AGE,
  });
  return response;
}

export const cartKey = (id: string) => `aurea:cart:${id}`;
export const ordersKey = (id: string) => `aurea:orders:${id}`;
