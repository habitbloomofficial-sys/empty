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

import { X509Certificate } from "node:crypto";
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
      found.push({ name, address: entry.address, netmask: entry.netmask });
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
 * Whether a certificate we already made is still worth serving.
 *
 * Certificates expire, and an expired one is refused by phones far more firmly
 * than an unsigned one — there is no "continue anyway" past a date that has
 * passed. Without this check phone access would simply stop working one day a
 * year from now, for no reason anybody could see. A fortnight of margin means
 * it renews quietly rather than on the morning it breaks.
 */
export function stillValid(pem, now = new Date()) {
  try {
    const expires = new Date(new X509Certificate(pem).validTo);
    return expires.getTime() - now.getTime() > 14 * 24 * 60 * 60 * 1000;
  } catch {
    // Unreadable is as good as expired: make a new one.
    return false;
  }
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
    const existing = fs.readFileSync(CERT_PATH);
    if (previous === wanted && stillValid(existing)) {
      return { cert: existing, key: fs.readFileSync(KEY_PATH) };
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
      // Some Android builds want a certificate to say what it is for before
      // they will even offer the "proceed anyway" button.
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
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

/** The launcher for this platform, so advice names a file that exists. */
const LAUNCHER = process.platform === "win32" ? ".bat" : ".command";

/** Loopback is this computer talking to itself; anything else is a real device. */
function isRemote(ip) {
  return Boolean(ip) && !/^(::1$|127\.|::ffff:127\.)/.test(ip);
}

/** 192.168.1.14 -> "192.168.1." — what his phone's own address should start with. */
export function subnetPrefix(entry) {
  if (!entry?.netmask || entry.netmask !== "255.255.255.0") return null;
  const parts = entry.address.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.` : null;
}

/**
 * Say out loud what is happening to the connection.
 *
 * This is the whole difference between "it doesn't work" and a problem you can
 * fix. Three things can happen after the QR code is scanned, and until now all
 * three looked identical from this side — a window sitting there saying nothing.
 *
 *   Nothing arrives          -> the firewall, or the two devices aren't on the
 *                               same network. Silence for 45 seconds says so.
 *   A connection, then gone  -> the certificate warning. The network is fine
 *                               and he only has to tap Continue.
 *   A request                -> it worked, and he should be told that too, so
 *                               he stops hunting for a problem he no longer has.
 */
function narrate(server, best) {
  let connected = false;
  let served = false;
  let explained = false;

  const stopped = (ip) => {
    if (served || explained) return;
    explained = true;
    console.log("");
    console.log(`  >> A device (${ip}) reached Axis, then stopped.`);
    console.log("     That is the certificate warning, and it means the hard");
    console.log("     part is already working - your phone found this computer.");
    console.log("     On the phone: tap Advanced, then Continue / Proceed");
    console.log("     anyway / Visit this website. On iPhone the wording is");
    console.log("     Show Details, then 'visit this website'.");
    console.log("");
  };

  // Any connection at all from another device, not just a completed handshake.
  // Modern phones finish the TLS handshake first and only then decide they
  // don't trust the certificate, so waiting for a TLS error misses the case
  // this is here to catch. A connection that never turns into a request is the
  // signature of somebody looking at a warning page.
  server.on("connection", (socket) => {
    const ip = socket.remoteAddress;
    if (!isRemote(ip)) return;
    connected = true;
    // Deliberately not cancelled when the socket closes. A phone that doesn't
    // trust the certificate hangs up immediately and draws the warning page
    // itself, so a closed connection is the normal shape of this, not a reason
    // to stay quiet. If he taps through, the request that follows sets
    // `served` and this says nothing.
    setTimeout(() => stopped(ip), 8_000).unref();
  });

  server.on("request", (req) => {
    if (!isRemote(req.socket?.remoteAddress)) return;
    connected = true;
    if (served) return;
    served = true;
    console.log("");
    console.log(`  >> Your phone is in. (${req.socket.remoteAddress})`);
    console.log("     Leave this window open and use Axis on the phone.");
    console.log("");
  });

  // Nothing at all, after long enough that it isn't just slow.
  setTimeout(() => {
    if (connected) return;
    const prefix = subnetPrefix(best);
    console.log("");
    console.log("  ------------------------------------------------------------");
    console.log("   Nothing has reached this computer yet.");
    console.log("  ------------------------------------------------------------");
    console.log("");
    console.log("  If you have scanned the code and it is spinning or says it");
    console.log("  can't connect, it is one of these three, in this order:");
    console.log("");
    if (process.platform === "win32") {
      console.log("  1. WINDOWS FIREWALL. Close this window, right-click");
      console.log("     START-AXIS-PHONE.bat and choose Run as administrator.");
      console.log("     It will put the rule in and this stops happening.");
    } else if (process.platform === "darwin") {
      console.log("  1. THE MAC FIREWALL. System Settings > Network >");
      console.log("     Firewall. Either switch it off, or open Options and");
      console.log("     allow incoming connections for node. If a dialog asked");
      console.log("     you this and got Don't Allow, that answer is remembered.");
    } else {
      console.log("  1. THE FIREWALL. Something on this machine is refusing");
      console.log(`     connections on port ${PORT}. Allow it, and try again.`);
    }
    console.log("");
    console.log("  2. NOT THE SAME WI-FI. Phones hop onto mobile data without");
    console.log("     telling you, and a guest network is a separate network.");
    console.log("     On the phone: Settings > Wi-Fi > tap your network, and");
    if (prefix) {
      console.log(`     check its IP address starts with  ${prefix}`);
      console.log("     If it starts with anything else, that is the problem.");
    } else {
      console.log("     check it is the same network name as this computer's.");
    }
    console.log("     Turn mobile data off for a moment to be certain.");
    console.log("");
    console.log("  3. THE ROUTER KEEPS DEVICES APART. Some routers, and most");
    console.log("     guest networks, have 'AP isolation' or 'client isolation'");
    console.log("     switched on, which stops your own devices from seeing");
    console.log("     each other. If you can't turn it off, use");
    console.log(`     START-AXIS-ANYWHERE${LAUNCHER} instead - that one goes out to`);
    console.log("     the internet and back, so the router has no say in it.");
    console.log("");
  }, 45_000).unref();
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

  const server = https.createServer({ cert, key }, (req, res) => handle(req, res));
  await new Promise((resolve, reject) => {
    server.listen(PORT, "0.0.0.0", resolve).on("error", reject);
  });

  const best = preferredAddress(addresses);
  narrate(server, best);
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
  const prefix = subnetPrefix(best);
  if (prefix) {
    console.log("");
    console.log(`  This computer is on the ${prefix}x network. If your phone's`);
    console.log("  Wi-Fi address doesn't start with those same numbers, it is on");
    console.log("  a different network and will never find this one.");
  }
  console.log("");
  console.log("  >> Now watch this window. It will tell you what your phone is");
  console.log("     doing - whether it arrived, stopped at the warning, or never");
  console.log("     got here at all. You don't have to guess.");
  console.log("");
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
