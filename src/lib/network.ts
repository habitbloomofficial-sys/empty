// Where a request came from, and how much that is worth trusting.
//
// Three zones, and the difference between them decides whether Axis answers at
// all:
//
//   loopback  this machine. Nobody else can reach it, ever.
//   private   your own Wi-Fi, or your own VPN. Reachable by things in your
//             house, and by nothing on the internet.
//   public    the open internet. Anyone, from anywhere.
//
// Axis can read your email, place calls, fire automations and open things on
// your computer. On the public internet that is not an app, it is a way in —
// so a request from there is refused unless it carries proof of a passcode.

export type Zone = "loopback" | "private" | "public";

/** Strip the IPv6-mapped-IPv4 prefix and any port or brackets. */
function clean(address: string): string {
  return address.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
}

export function zoneOf(rawAddress: string | undefined | null): Zone {
  const address = clean(rawAddress ?? "");
  if (!address) return "loopback";

  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return "loopback";

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "private";
    }
    // 169.254 is a link-local address: no router involved, so it is as local
    // as it gets. 100.64/10 is the carrier-grade NAT range, which is what
    // Tailscale and its like hand out — already authenticated by the VPN
    // itself before a packet ever reaches us.
    if (a === 169 && b === 254) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private";
    return "public";
  }

  const lower = address.toLowerCase();
  // fc00::/7 is the IPv6 equivalent of 10.x, fe80::/10 is link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(lower) || lower.startsWith("fe80:")) return "private";
  return "public";
}

/**
 * The address the request actually came from.
 *
 * `x-forwarded-for` is written by whatever is in front of us — a tunnel, a
 * reverse proxy — and it is a *list*, oldest first. The first entry is the
 * original client, which is the one that matters. Anyone can forge the header,
 * but forging it only ever makes a request look *more* remote than it is here:
 * a public address cannot be forged into a loopback one, because a request
 * carrying the header at all did not come from this machine directly.
 */
export function clientAddress(headers: Headers, fallback?: string | null): string | undefined {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  // Cloudflare's tunnel writes this one, and it is a single address.
  const cloudflare = headers.get("cf-connecting-ip");
  if (cloudflare) return cloudflare.trim();

  return fallback ?? undefined;
}

/**
 * The zone a request belongs to.
 *
 * A forwarding header means something is in front of us, and the only things
 * that sit in front of Axis are tunnels to the internet. So its mere presence
 * rules out loopback, even when the address it names looks local — that is
 * exactly what a forged header would say.
 */
export function requestZone(headers: Headers, fallback?: string | null): Zone {
  const forwarded = headers.get("x-forwarded-for") ?? headers.get("cf-connecting-ip");
  const zone = zoneOf(clientAddress(headers, fallback));
  if (forwarded && zone === "loopback") return "private";
  return zone;
}
