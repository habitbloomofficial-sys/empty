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

const CLOUDFLARED = path.join(process.cwd(), "data", "cloudflared.exe");
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
    console.error("  The tunnel program isn't here. Run START-AXIS-ANYWHERE.bat rather than this file.");
    process.exit(1);
  }

  const ready = await waitForAxis();
  if (!ready) {
    console.error("  Axis didn't start, so there is nothing to put on the internet.");
    console.error("  Try START-AXIS.bat on its own first and see what it says.");
    process.exit(1);
  }

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
