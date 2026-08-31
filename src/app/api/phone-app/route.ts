import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSetting } from "@/lib/settings";
import { isPasscodeSet, issueToken } from "@/lib/passcode";

export const runtime = "nodejs";

// Handing the phone version of Axis to the phone.
//
// AXIS-PHONE.html is the whole assistant in one file, and getting it onto a
// phone used to mean finding it in the repository and sending it over Discord.
// This serves it from Axis himself, which means the link is one he can open on
// the phone directly — and, more usefully, that the copy he gets already knows
// where this computer is and how to get in.
//
// That last part is what makes it work rather than merely arrive. A blank copy
// opens to a settings screen and a list of things to type on a phone keyboard;
// a baked copy opens connected.
//
// It is behind the same lock as everything else, and it has to be: the copy it
// hands out carries a sign-in token for this computer, and the keys too if he
// asks for them. The proxy refuses an unauthenticated request before this
// handler ever runs.

/** Values written into the file's BAKED block. Anything absent stays empty. */
interface Baked {
  brain: string;
  key: string;
  claudeKey: string;
  model: string;
  effort: string;
  honcho: string;
  eleven: string;
  voice: string;
  home: string;
  pass: string;
  token: string;
  title: string;
  speak: boolean | null;
  search: boolean | null;
}

const EMPTY: Baked = {
  brain: "",
  key: "",
  claudeKey: "",
  model: "",
  effort: "",
  honcho: "",
  eleven: "",
  voice: "",
  home: "",
  pass: "",
  token: "",
  title: "",
  speak: null,
  search: null,
};

/**
 * Rewrite the BAKED block.
 *
 * The same shape the file's own "Save a copy" writes, and deliberately so: one
 * format, so a copy made on the phone and a copy served from here are the same
 * kind of thing. Every value goes through JSON.stringify, which is what keeps a
 * passcode containing a quote from turning the file into a syntax error.
 */
export function bake(source: string, values: Baked): string {
  const block =
    "const BAKED = {\n" +
    (Object.keys(EMPTY) as (keyof Baked)[])
      .map((key) => `  ${key}: ${JSON.stringify(values[key])}`)
      .join(",\n") +
    "\n};";

  const replaced = source.replace(/const BAKED = \{[\s\S]*?\n\};/, () => block);
  if (replaced === source) {
    throw new Error("I couldn't find the settings block in the phone file.");
  }
  return replaced;
}

/**
 * Where the phone should call.
 *
 * Taken from the request rather than from a setting, because the request
 * already knows: if he is reading this over a tunnel the host is the tunnel,
 * and if he is on his own Wi-Fi it is the machine's address on it. A value he
 * would have had to type is a value he can get wrong.
 */
export function homeAddress(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? req.headers.get("host") ?? req.nextUrl.host;
  const protocol = (forwardedProto ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();

  // Loopback is the one address that is certainly wrong on a phone: it would
  // point the phone at itself. Better to leave it blank and have him fill it
  // in than to hand him something that cannot work.
  if (/^(127\.0\.0\.1|localhost|\[::1\]|::1)(:|$)/i.test(host)) return "";
  return `${protocol}://${host}`;
}

function readSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "AXIS-PHONE.html"), "utf-8");
}

function serve(baked: string): NextResponse {
  return new NextResponse(baked, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Downloaded rather than opened: opening it here would run it inside
      // this origin, where it is not what he wants and would put two copies of
      // Axis on the same screen.
      "content-disposition": 'attachment; filename="AXIS-PHONE.html"',
      "cache-control": "no-store",
    },
  });
}

/**
 * What goes into the copy.
 *
 * The passcode is never baked, and it could not be even if that were wanted —
 * it is stored as a scrypt hash and cannot be read back. A sign-in token is
 * baked instead, which is better in every way: the phone arrives already
 * connected without the passcode ever leaving this computer, and changing the
 * passcode revokes it along with every other phone.
 */
function values(req: NextRequest, options: { keys: boolean; connect: boolean; home?: string }): Baked {
  const out: Baked = {
    ...EMPTY,
    home: options.home?.trim() || homeAddress(req),
    title: getSetting("USER_TITLE") ?? "",
  };

  // A token is only worth anything if a passcode is set — without one the
  // computer refuses the internet anyway, and baking a token would suggest
  // otherwise.
  if (options.connect && isPasscodeSet()) out.token = issueToken();

  if (options.keys) {
    out.brain = getSetting("ANTHROPIC_API_KEY") ? "claude" : "gemini";
    out.key = getSetting("GEMINI_API_KEY") ?? "";
    out.claudeKey = getSetting("ANTHROPIC_API_KEY") ?? "";
    out.model = getSetting("ANTHROPIC_MODEL") ?? "";
    out.effort = getSetting("ANTHROPIC_EFFORT") ?? "";
    out.honcho = getSetting("HONCHO_API_KEY") ?? "";
    out.eleven = getSetting("ELEVENLABS_API_KEY") ?? "";
    out.voice = getSetting("ELEVENLABS_VOICE_ID") ?? "";
  }
  return out;
}

/**
 * The plain link.
 *
 * This is the one he can open on the phone directly, or point a QR code at. It
 * carries the address of this computer and a sign-in token, so it opens
 * connected — but no keys, because a link can be opened by whoever is holding
 * the phone and keys are the thing worth being careful with.
 */
export async function GET(req: NextRequest) {
  let file: string;
  try {
    file = readSource();
  } catch {
    return NextResponse.json(
      { error: "AXIS-PHONE.html isn't next to Axis on this computer, sir." },
      { status: 404 }
    );
  }

  const wants = req.nextUrl.searchParams;
  return serve(
    bake(file, values(req, {
      keys: wants.get("keys") === "1",
      connect: wants.get("connect") !== "0",
      home: wants.get("home") ?? undefined,
    }))
  );
}

/** The same thing with the options chosen in the Settings panel. */
export async function POST(req: NextRequest) {
  let file: string;
  try {
    file = readSource();
  } catch {
    return NextResponse.json(
      { error: "AXIS-PHONE.html isn't next to Axis on this computer, sir." },
      { status: 404 }
    );
  }

  let body: { keys?: unknown; connect?: unknown; home?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  return serve(
    bake(file, values(req, {
      keys: body.keys === true,
      connect: body.connect !== false,
      home: typeof body.home === "string" ? body.home : undefined,
    }))
  );
}
