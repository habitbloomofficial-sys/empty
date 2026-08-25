"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { findProduct } from "@/lib/shop/catalog";
import { normaliseQuantity, priceCart, type CartLine } from "@/lib/shop/order";

/*
 * The cart, held in two places at once.
 *
 * React state makes clicking instant. The cloud store makes it survive — a
 * closed laptop, a different machine, the browser's cache being cleared. So
 * every change is applied locally first and pushed a moment later, and the
 * only thing the buyer ever waits for is the initial read.
 *
 * Nothing here writes to localStorage. The cart belongs to the account, not to
 * the browser it happened to be built in.
 */

const PUSH_DELAY_MS = 550;

export type SyncState = "loading" | "saved" | "saving" | "offline";

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [sync, setSync] = useState<SyncState>("loading");
  const [storedIn, setStoredIn] = useState<"cloud" | "memory" | null>(null);

  const pending = useRef<CartLine[] | null>(null);
  const timer = useRef<number | null>(null);
  const loaded = useRef(false);

  // Read whatever this buyer left behind.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/shop/cart", { cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const data: { cart?: CartLine[]; storedIn?: "cloud" | "memory" } = await response.json();
        if (cancelled) return;
        setLines(Array.isArray(data.cart) ? data.cart : []);
        setStoredIn(data.storedIn ?? null);
        setSync("saved");
      } catch {
        if (!cancelled) setSync("offline");
      } finally {
        loaded.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const push = useCallback(async (next: CartLine[]) => {
    setSync("saving");
    try {
      const response = await fetch("/api/shop/cart", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart: next }),
      });
      if (!response.ok) throw new Error("rejected");
      const data: { storedIn?: "cloud" | "memory" } = await response.json();
      setStoredIn(data.storedIn ?? null);
      setSync("saved");
    } catch {
      setSync("offline");
    }
  }, []);

  /** Apply locally now; tell the cloud in a moment. */
  const commit = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      if (!loaded.current) return;
      pending.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const queued = pending.current;
        pending.current = null;
        if (queued) void push(queued);
      }, PUSH_DELAY_MS);
    },
    [push]
  );

  // A tab closing mid-debounce should not lose the last click.
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      navigator.sendBeacon?.(
        "/api/shop/cart",
        new Blob([JSON.stringify({ cart: pending.current })], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const add = useCallback(
    (sku: string, quantity: number) => {
      const product = findProduct(sku);
      if (!product) return;
      setLines((current) => {
        const existing = current.find((line) => line.sku === sku);
        const wanted = (existing?.quantity ?? 0) + quantity;
        const settled = normaliseQuantity(product, wanted);
        const next = existing
          ? current.map((line) => (line.sku === sku ? { ...line, quantity: settled } : line))
          : [...current, { sku, quantity: settled }];
        commit(next);
        return next;
      });
    },
    [commit]
  );

  const setQuantity = useCallback(
    (sku: string, quantity: number) => {
      const product = findProduct(sku);
      if (!product) return;
      const settled = normaliseQuantity(product, quantity);
      setLines((current) => {
        const next =
          settled <= 0
            ? current.filter((line) => line.sku !== sku)
            : current.map((line) => (line.sku === sku ? { ...line, quantity: settled } : line));
        commit(next);
        return next;
      });
    },
    [commit]
  );

  const remove = useCallback(
    (sku: string) => {
      setLines((current) => {
        const next = current.filter((line) => line.sku !== sku);
        commit(next);
        return next;
      });
    },
    [commit]
  );

  const clear = useCallback(() => {
    setLines([]);
    commit([]);
  }, [commit]);

  return {
    lines,
    totals: priceCart(lines),
    sync,
    storedIn,
    add,
    setQuantity,
    remove,
    clear,
  };
}

export type Cart = ReturnType<typeof useCart>;
