"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/shop/brand";
import { CATALOGUE_FACTS } from "@/lib/shop/catalog";
import { group } from "@/lib/shop/format";
import { VaultScene } from "./Scenes";
import { IconAlert, IconArrow, IconLock } from "./Icons";

/*
 * The door.
 *
 * The code is answered by the server, not compared here, so the right answer
 * never ships to the browser. What this component owns is everything around
 * that: it should feel like arriving somewhere by invitation rather than
 * hitting a login wall, and a wrong code should be unmistakable without being
 * insulting to somebody who simply mistyped.
 */

export function AccessGate({ onOpen }: { onOpen: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;

    setBusy(true);
    setError(null);
    setWrong(false);

    try {
      const response = await fetch("/api/shop/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data: { error?: string; left?: number } = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "That code is not recognised.");
        setLeft(typeof data.left === "number" ? data.left : null);
        setWrong(true);
        // Re-arm the shake for a second wrong answer in a row.
        window.setTimeout(() => setWrong(false), 600);
        inputRef.current?.select();
        return;
      }

      onOpen();
    } catch {
      setError("Couldn't reach the portal. Check your connection and try again.");
      setWrong(true);
      window.setTimeout(() => setWrong(false), 600);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`au-gate${wrong ? " au-gate--wrong" : ""}`}>
      <div className="au-gate__art">
        <VaultScene />
        <div className="au-gate__artcopy">
          <div className="au-kicker" style={{ color: "var(--gold-bright)", marginBottom: 16 }}>
            Wholesale · Est. {BRAND.since}
          </div>
          <h2>
            The trade counter for
            <br />
            people who sell on.
          </h2>
          <p>
            {group(CATALOGUE_FACTS.lines, 0)} lines across {CATALOGUE_FACTS.categories} categories,
            priced for resale and held in stock. Behind this door are trade prices — which is
            precisely why there is a door.
          </p>
          <div className="au-gate__seals">
            <span className="au-seal">B2B only</span>
            <span className="au-seal">EU-wide delivery</span>
            <span className="au-seal">Net {30} terms</span>
            <span className="au-seal">VAT reverse charge</span>
          </div>
        </div>
      </div>

      <div className="au-gate__panel">
        <form className="au-gate__form" onSubmit={submit} noValidate>
          <div className="au-wordmark">
            <span className="au-wordmark__name">{BRAND.name}</span>
            <span className="au-wordmark__rule" />
            <span className="au-wordmark__tag">{BRAND.kicker}</span>
          </div>

          <h1>Enter your access code</h1>
          <p>
            Codes are issued to approved trade accounts. If you don&apos;t have one, your account
            manager can arrange it the same day.
          </p>

          <label className="au-field">
            <span className="au-field__label">Access code</span>
            <input
              ref={inputRef}
              className="au-codeinput"
              type="password"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (error) setError(null);
              }}
              placeholder="••••••••"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "au-gate-error" : undefined}
              disabled={busy}
            />
          </label>

          {error && (
            <p className="au-gate__error" id="au-gate-error" role="alert">
              <IconAlert />
              <span>
                {error}
                {left !== null && left > 0 && left <= 4 && (
                  <>
                    {" "}
                    <span style={{ opacity: 0.75 }}>
                      {left} attempt{left === 1 ? "" : "s"} remaining.
                    </span>
                  </>
                )}
              </span>
            </p>
          )}

          <button className="au-btn au-btn--gold au-btn--full" type="submit" disabled={busy || !code.trim()}>
            {busy ? (
              <>
                <span className="au-spinner" /> Verifying
              </>
            ) : (
              <>
                Unlock the portal <IconArrow />
              </>
            )}
          </button>

          <div className="au-gate__meta">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <IconLock size={13} /> Encrypted session
            </span>
            <a href={`mailto:${BRAND.contact.email}`}>Request access</a>
          </div>
        </form>
      </div>
    </div>
  );
}
