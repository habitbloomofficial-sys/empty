import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { outputFolder } from "@/lib/documents";

export const runtime = "nodejs";

// Hands a model file to the browser so it can be projected.
//
// The path comes from the page, which means it cannot be trusted: the check is
// that the resolved file sits inside the Models folder and nowhere else. Same
// rule as the file search — one place decides what is reachable, and it
// resolves the path first so ".." cannot walk out of it.

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("path");
  if (!asked) return NextResponse.json({ error: "Which model, sir?" }, { status: 400 });

  const root = fs.realpathSync(path.join(outputFolder(), "Models"));
  let target: string;
  try {
    target = fs.realpathSync(path.resolve(root, asked));
  } catch {
    return NextResponse.json({ error: "There's no such model." }, { status: 404 });
  }

  const inside = target === root || target.startsWith(root + path.sep);
  if (!inside || !target.toLowerCase().endsWith(".stl")) {
    return NextResponse.json({ error: "That isn't a model of mine." }, { status: 403 });
  }

  const data = fs.readFileSync(target);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": "model/stl",
      "content-length": String(data.length),
      "cache-control": "no-store",
    },
  });
}
