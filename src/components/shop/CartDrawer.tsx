"use client";

import { useEffect } from "react";
import { TERMS } from "@/lib/shop/brand";
import { tierState } from "@/lib/shop/catalog";
import { group, money, moneyRound, percent } from "@/lib/shop/format";
import type { Cart } from "./useCart";
import { ProductArt } from "./ProductArt";
import { Stepper } from "./Stepper";
import { IconArrow, IconClose, IconCloud } from "./Icons";

/*
 * The order, as it stands.
 *
 * Two things here that a consumer cart never has. One: every line says how far
 * it is from the next volume break, because a buyer who is four cartons short
 * of 10% off would rather know now than after the invoice. Two: the panel that
 * adds up what the whole order is worth at retail. That number is the reason
 * they are buying, so it should be on screen when they commit.
 */
export function CartDrawer({
  cart,
  onClose,
  onCheckout,
}: {
  cart: Cart;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { totals } = cart;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const freeShippingPct = Math.min(100, (totals.goods / TERMS.freeShippingFrom) * 100);

  return (
    <>
      <div className="au-scrim" onClick={onClose} />
      <aside className="au-drawer" role="dialog" aria-modal="true" aria-label="Your order">
        <header className="au-drawer__head">
          <div>
            <h2>Your order</h2>
            <p>
              {totals.skuCount} {totals.skuCount === 1 ? "line" : "lines"} · {group(totals.unitCount, 0)} units
              {cart.storedIn === "cloud" && " · saved to the cloud"}
            </p>
          </div>
          <button className="au-drawer__close" onClick={onClose} aria-label="Close order">
            <IconClose />
          </button>
        </header>

        <div className="au-drawer__scroll">
          {totals.lines.length === 0 ? (
            <div style={{ padding: "60px 26px", textAlign: "center", color: "var(--ink-soft)" }}>
              <p style={{ fontSize: 15, marginBottom: 8, color: "var(--ink)" }}>Nothing on the order yet.</p>
              <p className="au-note">
                Add a line from the catalogue and it will appear here. Orders start at{" "}
                {moneyRound(TERMS.minimumOrder)} of goods.
              </p>
            </div>
          ) : (
            totals.lines.map((line) => {
              const { next } = tierState(line.product, line.quantity);
              const shortBy = next ? next.from - line.quantity : 0;
              return (
                <div className="au-line" key={line.product.sku}>
                  <div className="au-line__art">
                    <ProductArt art={line.product.art} tone={line.product.tone} />
                  </div>
                  <div>
                    <div className="au-line__top">
                      <div>
                        <div className="au-line__name">{line.product.name}</div>
                        <div className="au-line__sku">{line.product.sku}</div>
                      </div>
                      <div className="au-line__net">{money(line.net)}</div>
                    </div>

                    <div className="au-line__ctl">
                      <Stepper
                        product={line.product}
                        value={line.quantity}
                        onChange={(quantity) => cart.setQuantity(line.product.sku, quantity)}
                        compact
                      />
                      <span className="au-line__unit">
                        {money(line.unit)}/u
                        {line.saved > 0 && (
                          <span style={{ color: "var(--good)" }}> −{money(line.saved)}</span>
                        )}
                      </span>
                      <button
                        className="au-line__drop"
                        type="button"
                        onClick={() => cart.remove(line.product.sku)}
                      >
                        Remove
                      </button>
                    </div>

                    {next && shortBy > 0 && (
                      <p className="au-line__nudge">
                        {group(shortBy, 0)} more units ({group(shortBy / line.product.caseQty, 0)} cartons) takes
                        this line to {percent(next.discount)} off.
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {totals.lines.length > 0 && (
          <footer className="au-drawer__foot">
            {totals.shipping > 0 && (
              <>
                <div className="au-progressbar">
                  <i style={{ width: `${freeShippingPct}%` }} />
                </div>
                <p className="au-note" style={{ marginBottom: 14 }}>
                  {money(totals.toFreeShipping)} more and carriage is free.
                </p>
              </>
            )}

            <div className="au-profit">
              <h4>What this order is worth to you</h4>
              <div className="au-profit__row">
                <span>Retail value at RRP</span>
                <b>{money(totals.retailValue)}</b>
              </div>
              <div className="au-profit__row">
                <span>Gross profit</span>
                <b className="au-profit__big">{money(totals.profit)}</b>
              </div>
              <div className="au-profit__row">
                <span>Blended margin</span>
                <b>{percent(totals.margin)}</b>
              </div>
            </div>

            <div className="au-totals">
              <div>
                <span>Goods</span>
                <span>{money(totals.goods)}</span>
              </div>
              {totals.volumeSaved > 0 && (
                <div>
                  <span>Volume discount</span>
                  <span style={{ color: "var(--good)" }}>−{money(totals.volumeSaved)}</span>
                </div>
              )}
              <div>
                <span>Carriage</span>
                <span>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</span>
              </div>
              <div className="au-totals__grand">
                <span>Total excl. VAT</span>
                <span>{money(totals.total)}</span>
              </div>
            </div>

            {!totals.meetsMinimum && (
              <p className="au-note au-note--warn" style={{ marginBottom: 12 }}>
                Orders start at {moneyRound(TERMS.minimumOrder)} of goods — {money(TERMS.minimumOrder - totals.goods)}{" "}
                to go.
              </p>
            )}

            <button
              className="au-btn au-btn--gold au-btn--full"
              type="button"
              onClick={onCheckout}
              disabled={!totals.meetsMinimum}
            >
              Continue to order <IconArrow />
            </button>

            <p
              className="au-note"
              style={{ marginTop: 12, display: "flex", gap: 7, alignItems: "center", justifyContent: "center" }}
            >
              <IconCloud size={13} />
              {cart.sync === "offline"
                ? "Saved in this tab only — the cloud store is unreachable."
                : cart.storedIn === "cloud"
                  ? "Saved to your cloud account, not this device."
                  : "Held on the server for this session."}
            </p>
          </footer>
        )}
      </aside>
    </>
  );
}
