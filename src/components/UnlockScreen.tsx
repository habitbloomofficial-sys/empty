"use client";

import { useState } from "react";
import { postJson, describeClientFetchError } from "@/lib/clientFetch";

// What the internet sees.
//
// Deliberately the whole page and nothing else: no orb, no settings, no status
// rail. Anything rendered before the passcode is a detail given away to someone
// who has not yet proved they are you — and the shape of the interface, the
// name on the tab and the list of what he is connected to are all details.

export function UnlockScreen({ noPasscode }: { noPasscode: boolean }) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth", { passcode });
      // A full reload rather than a router push: the cookie has to be in place
      // before anything behind the lock is fetched, and the client router would
      // happily serve the cached lock screen back. Reloading asks for the same
      // address again — this page is a rewrite, so that address is whatever was
      // originally wanted.
      window.location.reload();
    } catch (err) {
      setError(describeClientFetchError(err));
      setPasscode("");
      setBusy(false);
    }
  }

  return (
    <main className="ax-room flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-[320px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-11 w-11 place-items-center border border-amber-400/50 shadow-[inset_0_0_18px_rgba(255,122,0,0.18)]">
            <div className="h-2 w-2 animate-blink bg-amber-300 shadow-[0_0_10px_#ff7a00]" />
          </div>
          <div className="text-[19px] font-medium leading-none tracking-[0.42em] text-cream">
            AXIS
          </div>
          <div className="ax-label text-[8px]">
            {noPasscode ? "NO PASSCODE SET" : "LOCKED"}
          </div>
        </div>

        {noPasscode ? (
          <p className="border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-300">
            Axis is reachable from the internet, but no passcode has been set —
            so he won&apos;t answer at all. Open him on the computer he runs on,
            go to <b>Settings → Remote access</b>, and set one. Then come back
            here.
          </p>
        ) : (
          <form onSubmit={unlock} className="space-y-3">
            <input
              type="password"
              inputMode="text"
              autoComplete="current-password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              className="w-full border border-amber-500/25 bg-black/50 px-3 py-2.5 text-center font-mono text-sm tracking-[0.2em] text-cream placeholder:tracking-normal placeholder:font-sans placeholder:text-sand-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
            <button
              type="submit"
              disabled={busy || !passcode.trim()}
              className="w-full bg-amber-500 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-400 disabled:opacity-40"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
            {error && (
              <p className="bg-rose-500/10 px-3 py-2 text-center text-[11px] text-rose-400">
                {error}
              </p>
            )}
          </form>
        )}

        <p className="mt-8 text-center text-[10px] leading-relaxed text-sand-700">
          You&apos;re reaching Axis from outside his own network, so he asks
          first.
        </p>
      </div>
    </main>
  );
}
