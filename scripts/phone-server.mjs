// Axis on your phone, over your own Wi-Fi.
//
// Two things have to be true for this to work, and the second is the one that
// catches people out.
//
// The server has to listen on the network rather than only on localhost — that
// part is easy. But browsers refuse the microphone on an insecure origin, and
// localhost is the *only* exception. Reach Axis from your phone over plain
// http and you get a mute assistant with no explanation. So this serves HTTPS
// with a certificate generated on your own machine.
//
// Nothing signed that certificate, so your phone will warn you once. That
// warning is accurate: it means "nobody has vouched for this". You are the one
// who made it, on the computer sitting in front of you, and tapping through it
// is the honest trade for a microphone that works.

import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import next from "next";
import qrcode from "qrcode-terminal";
import selfsigned from "selfsigned";

const PORT = Number(process.env.PORT || 3443);
const CERT_DIR = path.join(process.cwd(), "data", "certs");
const CERT_PATH = path.join(CERT_DIR, "phone-cert.pem");
const KEY_PATH = path.join(CERT_DIR, "phone-key.pem");

/** Every address this machine has on the local network. */
export function localAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

// Adapters that exist on a Windows machine but go nowhere useful. A laptop with
// Docker, WSL and a VPN installed reports half a dozen addresses, and picking
// the wrong one costs you ten minutes of a phone that won't connect.
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|docker|wsl|loopback|tailscale|zerotier|tap-|tun/i;

/** Private ranges, best first: home Wi-Fi is almost always 192.168. */
function rank(entry) {
  let score = 0;
  if (entry.address.startsWith("192.168.")) score += 3;
  else if (entry.address.startsWith("10.")) score += 2;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) score += 1;
  if (VIRTUAL.test(entry.name)) score -= 10;
  return score;
}

/**
 * The address most likely to be the one your phone can actually reach.
 *
 * Exported because it is the one piece of judgement in this file, and judgement
 * is worth testing.
 */
export function preferredAddress(addresses) {
  return [...addresses].sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * A certificate covering this machine's current addresses.
 *
 * Regenerated when the addresses change, because a certificate that doesn't
 * name the address you typed produces a harder browser refusal than one that
 * merely isn't signed by anyone.
 */
async function ensureCertificate(addresses) {
  const wanted = addresses.map((entry) => entry.address).sort().join(",");
  const stamp = path.join(CERT_DIR, "addresses.txt");

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    const previous = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf-8").trim() : "";
    if (previous === wanted) {
      return { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
    }
  }

  console.log("  Making a certificate for this computer...");
  const attributes = [{ name: "commonName", value: "Axis" }];
  // selfsigned v5 returns a promise; v4 and earlier returned the object
  // directly. Awaiting handles both, and getting this wrong fails at the point
  // where the private key is written rather than where it is generated.
  const pems = await selfsigned.generate(attributes, {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          ...addresses.map((entry) => ({ type: 7, ip: entry.address })),
        ],
      },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_PATH, pems.cert, { mode: 0o600 });
  fs.writeFileSync(KEY_PATH, pems.private, { mode: 0o600 });
  fs.writeFileSync(stamp, wanted);

  return { cert: pems.cert, key: pems.private };
}

async function main() {
  const addresses = localAddresses();
  if (addresses.length === 0) {
    console.error("  This computer isn't on a network, so your phone has nothing to reach.");
    process.exit(1);
  }

  const { cert, key } = await ensureCertificate(addresses);

  const app = next({ dev: false });
  await app.prepare();
  const handle = app.getRequestHandler();

  await new Promise((resolve, reject) => {
    https
      .createServer({ cert, key }, (req, res) => handle(req, res))
      .listen(PORT, "0.0.0.0", resolve)
      .on("error", reject);
  });

  const best = preferredAddress(addresses);
  const url = `https://${best.address}:${PORT}`;

  console.log("");
  console.log("  ================================================");
  console.log("   AXIS IS ON YOUR NETWORK");
  console.log("  ================================================");
  console.log("");
  console.log("  1. Point your phone's camera at this square.");
  console.log("");

  // Typing an IP address and a port on a phone keyboard is the step people
  // give up at. The camera app reads this and offers the link.
  await new Promise((resolve) => qrcode.generate(url, { small: true }, (square) => {
    for (const line of square.split("\n")) console.log(`      ${line}`);
    resolve();
  }));

  console.log("");
  console.log(`     ...or type it in yourself:   ${url}`);
  console.log("");

  const others = addresses.filter((entry) => entry.address !== best.address);
  if (others.length > 0) {
    console.log("     If that one doesn't work, this computer is also reachable at:");
    for (const entry of others) {
      console.log(`       https://${entry.address}:${PORT}   (${entry.name})`);
    }
    console.log("");
  }

  console.log("  2. Your phone will warn you the connection isn't private.");
  console.log("     That is expected and it is safe. Tap Advanced, then");
  console.log("     Continue / Proceed. You made that certificate yourself,");
  console.log("     on this computer, a moment ago - nobody else has vouched");
  console.log("     for it, which is all the warning means.");
  console.log("");
  console.log("  3. Install him as an app:");
  console.log("       iPhone   - Share button, then Add to Home Screen");
  console.log("       Android  - the three dots, then Install app");
  console.log("");
  console.log("  Both devices must be on the same Wi-Fi, and this window has to");
  console.log("  stay open - your phone is a window onto the Axis running here.");
  console.log("  Ctrl-C stops him.");
  console.log("");
}

// Only when run directly — this module is imported by its own test, and
// starting a server as a side effect of an import is its own bug.
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((error) => {
    console.error("  Couldn't start:", error?.message ?? error);
    process.exit(1);
  });
}
