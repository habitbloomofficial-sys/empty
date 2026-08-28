// Axis on the open internet, for as long as this window is open.
//
// cloudflared opens an outbound connection to Cloudflare and gets back a public
// https address that forwards to Axis on this machine. Nothing is opened on
// your router, no port is forwarded, and the address stops existing the moment
// this stops running.
//
// The address changes every time. That is a property of the free quick tunnel,
// and on balance a good one: an address nobody has seen before is one nobody
// can be sitting on. The QR code makes a new address cost you two seconds.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode-terminal";

// Windows gets an .exe; a Mac gets a plain binary out of Cloudflare's tarball.
// The launcher for each platform puts it here under the matching name.
const CLOUDFLARED = path.join(
  process.cwd(),
  "data",
  process.platform === "win32" ? "cloudflared.exe" : "cloudflared"
);
const LOCAL = "http://127.0.0.1:3000";

/** cloudflared announces the address in its log, amid a lot of other noise. */
export function findTunnelUrl(line) {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line);
  return match ? match[0] : null;
}

/** Wait for Axis himself to be answering before pointing the world at him. */
async function waitForAxis(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${LOCAL}/api/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// Whatever arrived after the line we were reading. Only ever non-empty when
// stdin is a pipe rather than a keyboard, which is how this gets tested.
let pending = "";

/**
 * Ask for something without printing it on a screen that stays open for hours.
 *
 * Written against stdin directly rather than node:readline. readline in
 * terminal mode redraws the line by moving the cursor to column zero and
 * clearing to the end of the screen — which erases the prompt this just wrote,
 * and no amount of intercepting what it echoes prevents that.
 */
function askSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);

    const stdin = process.stdin;
    const raw = Boolean(stdin.isTTY);
    let value = "";

    const finish = () => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };

    const consume = (text) => {
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === "\r" || char === "\n") {
          // Hold on to anything after the newline for the next question.
          pending = text.slice(i + 1).replace(/^\n/, "");
          finish();
          return true;
        }
        if (char === "\u0003") {
          // Ctrl-C, which has to keep working while the keyboard is in raw mode.
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Stars rather than nothing: a prompt that shows no response at all
        // reads as a frozen window, and people give up on it.
        value += char;
        process.stdout.write("*");
      }
      return false;
    };

    const onData = (chunk) => consume(chunk.toString("utf-8"));
    const onEnd = () => finish();

    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    stdin.on("end", onEnd);

    // A line may already have arrived with the previous one.
    if (pending) {
      const held = pending;
      pending = "";
      if (consume(held)) return;
    }
  });
}

/**
 * Set the passcode here, rather than sending him somewhere else to do it.
 *
 * This used to refuse to start and tell him to open Axis on the computer, go to
 * Settings, find Remote access and set one — four steps away from the window he
 * was already looking at, which is three more than anybody follows. The lock is
 * not negotiable, but where you fit it is.
 *
 * It goes through Axis's own API rather than writing the file directly, so
 * there is one piece of code that decides how a passcode is stored, and this
 * isn't a second one that could drift from it.
 */
export async function ensurePasscode() {
  let set = false;
  try {
    const res = await fetch(`${LOCAL}/api/auth`, { cache: "no-store" });
    set = Boolean((await res.json())?.passcodeSet);
  } catch {
    return false;
  }
  if (set) return true;

  console.log("");
  console.log("  ------------------------------------------------------------");
  console.log("   First, a passcode.");
  console.log("  ------------------------------------------------------------");
  console.log("");
  console.log("  In a moment Axis will have a web address that works from");
  console.log("  anywhere in the world. He reads your mail and opens things on");
  console.log("  this computer, so that address needs a lock on it - and this is");
  console.log("  the only thing standing between your computer and whoever else");
  console.log("  finds it.");
  console.log("");
  console.log("  Six characters or more. You will type it on your phone once,");
  console.log("  and then not again for a month. Pick something you'll remember.");
  console.log("");

  for (let attempt = 0; attempt < 3; attempt++) {
    const first = (await askSecret("  Passcode:        ")).trim();
    if (first.length < 6) {
      console.log("  That's too short - six characters or more.");
      console.log("");
      continue;
    }
    const again = (await askSecret("  And again:       ")).trim();
    if (first !== again) {
      console.log("  Those two don't match. Let's try again.");
      console.log("");
      continue;
    }

    const res = await fetch(`${LOCAL}/api/auth`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: first }),
    });
    if (res.ok) {
      console.log("");
      console.log("  Set. You can change it later in Settings > Remote access.");
      return true;
    }
    const error = await res.json().catch(() => ({}));
    console.log(`  ${error?.error ?? "That didn't save."}`);
    console.log("");
  }

  console.log("");
  console.log("  No passcode, so nothing is going on the internet. Run this");
  console.log("  again when you're ready.");
  return false;
}

function announce(url) {
  console.log("");
  console.log("  ================================================");
  console.log("   AXIS IS ON THE INTERNET");
  console.log("  ================================================");
  console.log("");
  console.log("  1. Point your phone's camera at this square.");
  console.log("");
  qrcode.generate(url, { small: true }, (square) => {
    for (const line of square.split("\n")) console.log(`      ${line}`);

    console.log("");
    console.log(`     ...or type it in:  ${url}`);
    console.log("");
    console.log("  2. He will ask for your passcode. That is the point of it.");
    console.log("");
    console.log("  3. Add him to your home screen and he stays one tap away:");
    console.log("       iPhone   - Share, then Add to Home Screen");
    console.log("       Android  - the three dots, then Install app");
    console.log("");
    console.log("  This address is new every time and dies when this window");
    console.log("  closes. This computer has to stay awake and online while");
    console.log("  you are away - check its sleep settings before you travel.");
    console.log("");
    console.log("  Ctrl-C takes him off the internet.");
    console.log("");
  });
}

async function main() {
  if (!fs.existsSync(CLOUDFLARED)) {
    console.error(
      "  The tunnel program isn't here. Run " +
        (process.platform === "win32" ? "START-AXIS-ANYWHERE.bat" : "START-AXIS-ANYWHERE.command") +
        " rather than this file."
    );
    process.exit(1);
  }

  const ready = await waitForAxis();
  if (!ready) {
    console.error("  Axis didn't start, so there is nothing to put on the internet.");
    console.error("  Try START-AXIS.bat on its own first and see what it says.");
    process.exit(1);
  }

  if (!(await ensurePasscode())) process.exit(1);

  const tunnel = spawn(CLOUDFLARED, ["tunnel", "--url", LOCAL, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let announced = false;
  const read = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      const url = findTunnelUrl(line);
      if (url && !announced) {
        announced = true;
        announce(url);
      }
    }
  };

  // cloudflared writes everything to stderr, including the address.
  tunnel.stdout.on("data", read);
  tunnel.stderr.on("data", read);

  tunnel.on("exit", (code) => {
    if (!announced) {
      console.error("");
      console.error(`  The tunnel closed before it gave us an address (code ${code}).`);
      console.error("  Cloudflare's free tunnels are occasionally busy — try again.");
    }
    process.exit(code ?? 0);
  });

  const stop = () => tunnel.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((error) => {
    console.error("  Couldn't start:", error?.message ?? error);
    process.exit(1);
  });
}
