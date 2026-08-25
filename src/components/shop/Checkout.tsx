"use client";

import { useState } from "react";
import { BRAND, TERMS } from "@/lib/shop/brand";
import { group, money, percent } from "@/lib/shop/format";
import {
  isEmail,
  missingDetails,
  type BuyerDetails,
  type PlacedOrder,
} from "@/lib/shop/order";
import type { Cart } from "./useCart";
import { IconAlert, IconArrow, IconBack, IconCheck, IconCloud } from "./Icons";

/*
 * Confirming the order.
 *
 * One screen, not a five-step funnel: a trade buyer placing their fourth order
 * of the month does not need to be walked anywhere. The server re-prices the
 * cart from its own copy when this is submitted, so what is shown here is a
 * quotation and what comes back is the order.
 */

const EMPTY: BuyerDetails = {
  company: "",
  vat: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  postcode: "",
  country: "",
  reference: "",
  notes: "",
};

export function Checkout({
  cart,
  onBack,
  onPlaced,
}: {
  cart: Cart;
  onBack: () => void;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const [buyer, setBuyer] = useState<BuyerDetails>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const { totals } = cart;
  const missing = missingDetails(buyer);
  const emailBad = buyer.email.trim().length > 0 && !isEmail(buyer.email);

  const set = (field: keyof BuyerDetails) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBuyer((current) => ({ ...current, [field]: event.target.value }));

  const bad = (field: keyof BuyerDetails) =>
    touched && (missing.includes(field) || (field === "email" && emailBad)) ? true : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy) return;

    if (missing.length > 0 || emailBad) {
      setError("Fill in the highlighted fields and we'll get this booked in.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer, cart: cart.lines }),
      });
      const data: { order?: PlacedOrder; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok || !data.order) {
        setError(data.error ?? "The order could not be placed. Try again in a moment.");
        return;
      }
      cart.clear();
      onPlaced(data.order);
    } catch {
      setError("Couldn't reach the portal. Your order has not been placed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="au-sheet">
      <div className="au-sheet__inner">
        <header className="au-sheet__head">
          <div>
            <div className="au-kicker" style={{ color: "var(--gold)", marginBottom: 8 }}>
              Purchase order
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 200, letterSpacing: "-0.03em" }}>Confirm your order</h1>
          </div>
          <button className="au-btn au-btn--ghost au-btn--sm" type="button" onClick={onBack}>
            <IconBack size={14} /> Back to the catalogue
          </button>
        </header>

        <form className="au-sheet__cols" onSubmit={submit} noValidate>
          <div>
            {error && (
              <div className="au-alert au-alert--bad" role="alert">
                <IconAlert />
                <span>{error}</span>
              </div>
            )}

            <section className="au-panel">
              <h3>Account</h3>
              <p className="au-panel__hint">
                Goes on the invoice and the packing note. A VAT number registered in the EU means the invoice is
                reverse-charged.
              </p>
              <div className="au-formgrid">
                <label className="au-wide">
                  <span className="au-lbl">Company name *</span>
                  <input className="au-input" value={buyer.company} onChange={set("company")} data-bad={bad("company")} autoComplete="organization" />
                </label>
                <label>
                  <span className="au-lbl">VAT number</span>
                  <input className="au-input" value={buyer.vat} onChange={set("vat")} placeholder="DK12345678" />
                </label>
                <label>
                  <span className="au-lbl">Your PO reference</span>
                  <input className="au-input" value={buyer.reference} onChange={set("reference")} placeholder="Optional" />
                </label>
                <label>
                  <span className="au-lbl">Contact name *</span>
                  <input className="au-input" value={buyer.contact} onChange={set("contact")} data-bad={bad("contact")} autoComplete="name" />
                </label>
                <label>
                  <span className="au-lbl">Email *</span>
                  <input className="au-input" type="email" value={buyer.email} onChange={set("email")} data-bad={bad("email")} autoComplete="email" />
                </label>
                <label className="au-wide">
                  <span className="au-lbl">Phone</span>
                  <input className="au-input" value={buyer.phone} onChange={set("phone")} autoComplete="tel" />
                </label>
              </div>
            </section>

            <section className="au-panel">
              <h3>Delivery</h3>
              <p className="au-panel__hint">
                Pallet deliveries need somewhere that can receive one. Tell us below if there is no loading bay.
              </p>
              <div className="au-formgrid">
                <label className="au-wide">
                  <span className="au-lbl">Street address *</span>
                  <input className="au-input" value={buyer.address} onChange={set("address")} data-bad={bad("address")} autoComplete="street-address" />
                </label>
                <label>
                  <span className="au-lbl">City *</span>
                  <input className="au-input" value={buyer.city} onChange={set("city")} data-bad={bad("city")} autoComplete="address-level2" />
                </label>
                <label>
                  <span className="au-lbl">Postcode *</span>
                  <input className="au-input" value={buyer.postcode} onChange={set("postcode")} data-bad={bad("postcode")} autoComplete="postal-code" />
                </label>
                <label className="au-wide">
                  <span className="au-lbl">Country *</span>
                  <input className="au-input" value={buyer.country} onChange={set("country")} data-bad={bad("country")} autoComplete="country-name" />
                </label>
                <label className="au-wide">
                  <span className="au-lbl">Delivery notes</span>
                  <textarea className="au-textarea" value={buyer.notes} onChange={set("notes")} placeholder="Access, opening hours, who to ask for." />
                </label>
              </div>
            </section>
          </div>

          <aside>
            <div className="au-panel au-summary">
              <h3>Order summary</h3>
              <p className="au-panel__hint">
                {totals.skuCount} lines · {group(totals.unitCount, 0)} units
              </p>

              <div className="au-summary__lines">
                {totals.lines.map((line) => (
                  <div className="au-summary__line" key={line.product.sku}>
                    <span>
                      {line.product.name}
                      <br />
                      <span className="au-mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                        {group(line.quantity, 0)} × {money(line.unit)}
                      </span>
                    </span>
                    <b>{money(line.net)}</b>
                  </div>
                ))}
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

              <div className="au-profit" style={{ marginTop: 14 }}>
                <h4>Projected on resale</h4>
                <div className="au-profit__row">
                  <span>Retail value</span>
                  <b>{money(totals.retailValue)}</b>
                </div>
                <div className="au-profit__row">
                  <span>Gross profit</span>
                  <b className="au-profit__big">{money(totals.profit)}</b>
                </div>
                <div className="au-profit__row">
                  <span>Margin</span>
                  <b>{percent(totals.margin)}</b>
                </div>
              </div>

              <button className="au-btn au-btn--gold au-btn--full" type="submit" disabled={busy} style={{ marginTop: 16 }}>
                {busy ? (
                  <>
                    <span className="au-spinner" /> Placing order
                  </>
                ) : (
                  <>
                    Place the order <IconArrow />
                  </>
                )}
              </button>

              <p className="au-note" style={{ marginTop: 12 }}>
                Payment on {TERMS.netDays}-day terms once your account is approved, or by transfer against the
                proforma. Nothing is charged now.
              </p>
            </div>
          </aside>
        </form>
      </div>
    </div>
  );
}

/* --- confirmation --------------------------------------------------------- */

export function OrderPlaced({ order, onDone }: { order: PlacedOrder; onDone: () => void }) {
  return (
    <div className="au-sheet">
      <div className="au-sheet__inner">
        <div className="au-done">
          <div className="au-done__mark">
            <IconCheck size={38} />
          </div>
          <h2>Order received</h2>
          <p>
            Confirmation is on its way to <b>{order.buyer.email}</b>. Our warehouse team will come back within one
            working day with the dispatch date.
          </p>

          <div className="au-ref">
            <span>Order reference</span>
            <b>{order.reference}</b>
          </div>

          <div className="au-done__grid">
            <div className="au-done__cell">
              <b>{money(order.total)}</b>
              <span>Total excl. VAT</span>
            </div>
            <div className="au-done__cell">
              <b>{group(order.unitCount, 0)}</b>
              <span>Units</span>
            </div>
            <div className="au-done__cell">
              <b>{money(order.retailValue)}</b>
              <span>Retail value</span>
            </div>
            <div className="au-done__cell">
              <b>{money(order.profit)}</b>
              <span>Gross profit</span>
            </div>
          </div>

          <p className="au-note" style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 26 }}>
            <IconCloud size={13} />
            {order.storedIn === "cloud"
              ? "Filed in your cloud account — reachable from any machine you sign in from."
              : "Filed on the server for this session. Connect a cloud store to keep order history permanently."}
          </p>

          <button className="au-btn au-btn--ink" type="button" onClick={onDone}>
            Back to the catalogue <IconArrow />
          </button>

          <p className="au-note" style={{ marginTop: 26 }}>
            Questions on this order? {BRAND.contact.email} · {BRAND.contact.phone}
          </p>
        </div>
      </div>
    </div>
  );
}
