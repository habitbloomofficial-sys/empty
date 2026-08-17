import { NextRequest, NextResponse } from "next/server";
import { saveTokenFromCode } from "@/lib/gmail";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/?gmail=error`);
  }

  try {
    await saveTokenFromCode(code);
    return NextResponse.redirect(`${origin}/?gmail=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/?gmail=error`);
  }
}
