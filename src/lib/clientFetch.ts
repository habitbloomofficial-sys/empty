// Browser-side fetch helpers.
//
// When a request never reaches the server, fetch rejects with a TypeError
// whose entire message is "Failed to fetch" — four words that name neither the
// cause nor the cure. It happens for exactly two reasons on a local install:
// the dev server isn't running any more, or it was still busy when the request
// went out. Both are fixable in seconds by someone who's told which it is.

/** How long to wait for our own server before assuming it isn't coming back. */
const DEFAULT_TIMEOUT_MS = 30_000;

export function describeClientFetchError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The JARVIS server took too long to answer, sir. It may still be starting up — give it a moment and try again.";
  }
  if (error instanceof TypeError) {
    return "I couldn't reach the JARVIS server, sir. Check the terminal you started it in is still running, then try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

/** True for the failures that are worth trying again rather than reporting. */
function isTransient(error: unknown): boolean {
  // A TypeError from fetch means the request never completed: the server was
  // restarting, the socket was reset, the machine slept. None of those are
  // reasons to lose what someone just said.
  return error instanceof TypeError;
}

/**
 * fetch, with one automatic retry when the request never reached the server.
 *
 * This is the difference between "Failed to fetch" and not noticing anything
 * happened. A local server restarting takes well under a second, and a person
 * mid-conversation should not be the one to work out that they should try
 * again.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 1, backoffMs = 700 }: { retries?: number; backoffMs?: number } = {}
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      // A body can only be sent once, so anything streaming a body up (an
      // audio upload) must not be replayed blindly.
      const replayable = !init.body || typeof init.body === "string";
      if (!isTransient(err) || !replayable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error(describeClientFetchError(lastError));
}

/**
 * POST JSON and read JSON back, with a deadline and a legible failure.
 * Errors carry the server's own `error` field when there is one.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: { method?: string; timeoutMs?: number } = {}
): Promise<T> {
  const { method = "POST", timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const res = await fetchWithRetry(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(data?.error || `The server answered ${res.status}.`);
  }
  if (!data) {
    throw new Error("The server sent back something I couldn't read.");
  }
  return data;
}
