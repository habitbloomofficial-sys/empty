"use client";

import { useState } from "react";
import { marginAt, stockLevel, unitPriceAt, type Product } from "@/lib/shop/catalog";
import { group, money, percent } from "@/lib/shop/format";
import { ProductArt } from "./ProductArt";
import { Stepper } from "./Stepper";
import { IconCart } from "./Icons";

const BADGE_TEXT: Record<NonNullable<Product["badge"]>, string> = {
  bestseller: "Bestseller",
  new: "New in",
  limited: "Limited run",
  restocked: "Back in stock",
};

/*
 * One line of the catalogue.
 *
 * A reseller decides on four numbers — what it costs them, what it sells for,
 * how many they must take, and how many exist — so all four are on the card
 * rather than one click away. The margin chip is the one that actually closes
 * the sale, so it is the one that is coloured.
 */
export function ProductCard({
  product,
  inCart,
  onAdd,
  onOpen,
  index,
}: {
  product: Product;
  inCart: number;
  onAdd: (quantity: number) => void;
  onOpen: () => void;
  index: number;
}) {
  const [quantity, setQuantity] = useState(product.moq);
  const level = stockLevel(product);
  const unit = unitPriceAt(product, quantity);
  const margin = marginAt(product, quantity);

  return (
    <article
      className="au-card"
      style={{ animationDelay: `${Math.min(index, 14) * 26}ms` }}
    >
      <div
        className="au-card__art"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        aria-label={`View details for ${product.name}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <ProductArt art={product.art} tone={product.tone} />
        {product.badge && (
          <span className={`au-badge au-badge--${product.badge}`}>{BADGE_TEXT[product.badge]}</span>
        )}
        <span className="au-card__sku">{product.sku}</span>
        <span className="au-card__quick">Specifications & volume breaks</span>
      </div>

      <div className="au-card__body">
        <h3 className="au-card__name">{product.name}</h3>
        <p className="au-card__blurb">{product.blurb}</p>

        <div className="au-prices">
          <span className="au-price">
            {money(unit)} <span className="au-price__unit">/ unit</span>
          </span>
          <span className="au-rrp">RRP {money(product.rrp)}</span>
          <span className="au-chip au-chip--gold">{percent(margin)} margin</span>
        </div>

        <div className="au-meta">
          <span>
            MOQ <b>{group(product.moq, 0)}</b>
          </span>
          <span>
            Carton <b>{group(product.caseQty, 0)}</b>
          </span>
          <span>
            Lead <b>{product.leadDays}d</b>
          </span>
          <span>
            Stock{" "}
            <b style={{ color: level === "low" ? "var(--warn)" : level === "out" ? "var(--bad)" : undefined }}>
              {level === "out" ? "None" : group(product.stock, 0)}
            </b>
          </span>
        </div>

        <div className="au-add">
          <Stepper product={product} value={quantity} onChange={setQuantity} />
          <button
            className="au-btn au-btn--ink"
            type="button"
            onClick={() => onAdd(quantity)}
            disabled={level === "out"}
          >
            <IconCart size={15} />
            {inCart > 0 ? "Add more" : "Add"}
          </button>
        </div>

        {inCart > 0 && (
          <p className="au-note" style={{ color: "var(--good)" }}>
            {group(inCart, 0)} units already on this order
          </p>
        )}
      </div>
    </article>
  );
}
