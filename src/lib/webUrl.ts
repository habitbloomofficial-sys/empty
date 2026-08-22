// Deciding whether an address is a real, public web page.
//
// Two different features lean on this and both of them are places where a
// wrong answer is expensive. Opening a URL hands it to Windows, which resolves
// some schemes through registered protocol handlers — a few of those have been
// used to execute code. Fetching a URL happens from inside the machine Axis
// runs on, which sits behind the home router and inside the network: an
// address pointing at 192.168.x.x or the router's admin page is not a web
// page, it's a way of reaching something that trusted this machine.
//
// So both paths come through here, and both get the same answer.

/**
 * Addresses that shouldn't be reachable this way. A browser opening a page on
 * your own machine or router is a different thing from opening a public site,
 * and it isn't what "open a website" is ever meant to mean.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Parse and normalise a web address, refusing anything that isn't a plain
 * public http(s) page.
 *
 * The scheme check is the important one. Windows resolves URIs like
 * `ms-msdt:` or `search-ms:` through registered protocol handlers, some of
 * which have been used to execute code; `file:` reads local disk and
 * `javascript:`/`data:` run in the browser. Only http and https ever get
 * through here.
 */
export function normalizeWebUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("No website given, sir.");

  // A bare domain like "bbc.co.uk" is what people say; assume https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`"${input}" doesn't look like a website address, sir.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `I'll only open ordinary web pages, sir — "${url.protocol}" isn't one.`
    );
  }
  if (url.username || url.password) {
    throw new Error("I won't open a link with a username and password baked into it, sir.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("That address is on this machine or your local network, sir — I'll leave it be.");
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new Error(`"${input}" doesn't look like a website address, sir.`);
  }

  // URL.toString() percent-encodes spaces and non-ASCII and punycodes the
  // host, so what leaves here is always printable ASCII with no whitespace.
  const normalized = url.toString();
  if (!/^[\x21-\x7E]+$/.test(normalized)) {
    throw new Error("That address contains characters I won't pass on, sir.");
  }
  return normalized;
}

