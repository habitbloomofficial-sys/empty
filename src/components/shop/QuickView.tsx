"use client";

import { useEffect, useState } from "react";
import {
  categoryOf,
  marginAt,
  markup,
  stockLevel,
  unitPriceAt,
  type Product,
} from "@/lib/shop/catalog";
import { group, money, multiple, percent, units } from "@/lib/shop/format";
import { ProductArt } from "./ProductArt";
import { Stepper } from "./Stepper";
import { IconCart, IconClose } from "./Icons";

/*
 * The full sheet on one line.
 *
 * Same information a printed trade catalogue would carry on the page opposite
 * the photograph: specification, the volume ladder in full, and the arithmetic
 * of the order you are about to place, updated as you change the quantity.
 */
export function QuickView({
  product,
  inCart,
  onAdd,
  onClose,
}: {
  product: Product;
  inCart: number;
  onAdd: (quantity: number) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(Math.max(product.moq, inCart || product.moq));
  const unit = unitPriceAt(product, quantity);
  const level = stockLevel(product);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = [
    { from: product.moq, discount: 0, label: `${group(product.moq, 0)}+ (MOQ)` },
    ...product.tiers.map((tier) => ({
      from: tier.from,
      discount: tier.discount,
      label: `${group(tier.from, 0)}+ (${group(tier.from / product.caseQty, 0)} cartons)`,
    })),
  ];
  const activeFrom = rows.reduce((best, row) => (quantity >= row.from ? row.from : best), rows[0].from);

  return (
    <>
      <div className="au-scrim" onClick={onClose} />
      <div className="au-modal" role="dialog" aria-modal="true" aria-label={product.name}>
        <div className="au-modal__card">
          <div className="au-modal__art">
            <ProductArt art={product.art} tone={product.tone} />
            <span className="au-card__sku">{product.sku}</span>
          </div>

          <div className="au-modal__side">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
              <div>
                <div className="au-kicker" style={{ color: "var(--gold)", marginBottom: 8 }}>
                  {categoryOf(product.category).name}
                </div>
                <h2>{product.name}</h2>
              </div>
              <button className="au-drawer__close" onClick={onClose} aria-label="Close" style={{ color: "var(--ink-soft)" }}>
                <IconClose />
              </button>
            </div>

            <p>{product.blurb}</p>

            <div className="au-prices">
              <span className="au-price" style={{ fontSize: 26 }}>
                {money(unit)} <span className="au-price__unit">/ unit</span>
              </span>
              <span className="au-rrp">RRP {money(product.rrp)}</span>
              <span className="au-chip au-chip--gold">{percent(marginAt(product, quantity))} margin</span>
              <span className="au-chip au-chip--quiet">{multiple(markup(product))} markup</span>
            </div>

            <div>
              <div className="au-kicker" style={{ color: "var(--ink-faint)", marginBottom: 9 }}>
                Volume breaks
              </div>
              <table className="au-tiers">
                <thead>
                  <tr>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Your margin</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.from} data-on={row.from === activeFrom}>
                      <td>{row.label}</td>
                      <td>{money(product.trade * (1 - row.discount))}</td>
                      <td>{percent((product.rrp - product.trade * (1 - row.discount)) / product.rrp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="au-specs">
              {product.specs.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt>Availability</dt>
                <dd style={{ color: level === "low" ? "var(--warn)" : level === "out" ? "var(--bad)" : "var(--good)" }}>
                  {level === "out" ? "Out of stock" : `${units(product.stock)} · ${product.leadDays} day lead`}
                </dd>
              </div>
            </dl>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 0",
                borderTop: "1px solid var(--line)",
                fontSize: 13.5,
              }}
            >
              <span style={{ color: "var(--ink-soft)" }}>
                {units(quantity)} · {group(quantity / product.caseQty, 0)} cartons
              </span>
              <b className="au-mono">{money(unit * quantity)}</b>
            </div>

            <div className="au-add">
              <Stepper product={product} value={quantity} onChange={setQuantity} />
              <button
                className="au-btn au-btn--gold"
                type="button"
                disabled={level === "out"}
                onClick={() => {
                  onAdd(quantity);
                  onClose();
                }}
              >
                <IconCart size={15} /> Add to order
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
