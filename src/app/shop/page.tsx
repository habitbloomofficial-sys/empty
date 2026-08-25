import { cookies } from "next/headers";
import { ShopExperience } from "@/components/shop/ShopExperience";
import { COOKIE_NAME, isValidToken } from "@/lib/shop/access";
import { BUYER_COOKIE } from "@/lib/shop/session";
import { prefsKey, type Prefs } from "@/lib/shop/prefs";
import { readJson } from "@/lib/shop/store";

// Whether you are signed in is decided per request, on the server.
export const dynamic = "force-dynamic";

/*
 * The whole portal hangs off this one route.
 *
 * The session check happens here rather than in the browser, so an unsigned
 * visitor never receives the catalogue at all — not hidden behind a component
 * that could be skipped, simply not sent. Whether the introduction has already
 * been watched is read here too, so the right room renders on the first paint
 * instead of flashing the wrong one while a fetch resolves.
 */
export default async function ShopPage() {
  const jar = await cookies();
  const signedIn = isValidToken(jar.get(COOKIE_NAME)?.value);

  let introSeen = false;
  if (signedIn) {
    const buyer = jar.get(BUYER_COOKIE)?.value;
    if (buyer) {
      const prefs = await readJson<Prefs>(prefsKey(buyer));
      introSeen = prefs?.introSeen === true;
    }
  }

  return <ShopExperience signedIn={signedIn} introSeen={introSeen} />;
}
