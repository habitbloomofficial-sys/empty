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
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(describeClientFetchError(err));
  }

  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(data?.error || `The server answered ${res.status}.`);
  }
  if (!data) {
    throw new Error("The server sent back something I couldn't read.");
  }
  return data;
}
