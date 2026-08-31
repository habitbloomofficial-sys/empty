import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// A QR code for the phone download link.
//
// Rendered on the server because the QR library is a server dependency, and
// because a picture is the only sensible way to get a long address from a
// screen onto a phone — nobody types "https://something-something.trycloudflare.com"
// correctly the first time.

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "Nothing to encode." }, { status: 400 });

  // Only ever an address, and only ever a web one. This renders whatever it is
  // given into a picture people point phones at, so it is worth being sure it
  // cannot be pointed somewhere unexpected.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "That isn't an address." }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "That isn't a web address." }, { status: 400 });
  }

  const QRCode = (await import("qrcode")).default;
  const svg = await QRCode.toString(parsed.toString(), {
    type: "svg",
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  return new NextResponse(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
  });
}
