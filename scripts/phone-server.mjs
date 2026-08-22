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

  console.log("");
  console.log("  Axis is on your network. On your phone, open:");
  console.log("");
  for (const entry of addresses) {
    console.log(`      https://${entry.address}:${PORT}      (${entry.name})`);
  }
  console.log("");
  console.log("  Your phone will warn that the certificate isn't trusted — that's");
  console.log("  expected. Tap Advanced, then continue. You made this certificate");
  console.log("  yourself, on this computer, a moment ago.");
  console.log("");
  console.log("  Then use your browser's Share or menu button and choose");
  console.log('  "Add to Home Screen" to install Axis as an app.');
  console.log("");
  console.log("  Both devices have to be on the same Wi-Fi. Ctrl-C stops him.");
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
