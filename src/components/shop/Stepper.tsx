"use client";

import { useState } from "react";
import type { Product } from "@/lib/shop/catalog";
import { normaliseQuantity } from "@/lib/shop/order";
import { IconMinus, IconPlus } from "./Icons";

/*
 * A quantity control that can only produce quantities the warehouse can pick.
 *
 * Steps in whole cartons, floors at the MOQ, ceilings at what is actually on
 * the racking. Typing is allowed while the field has focus — correcting a
 * half-typed "2" to "12" the instant it is entered is maddening — and the
 * value is settled on blur.
 */

export function Stepper({
  product,
  value,
  onChange,
  compact,
}: {
  product: Product;
  value: number;
  onChange: (quantity: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // While the field has focus the draft is the truth; the rest of the time the
  // settled quantity is. Deriving it means a change made elsewhere — the cart
  // drawer, a volume nudge — shows up here without a round trip through state.
  const shown = editing ? draft : String(value);

  const ceiling = Math.floor(product.stock / product.caseQty) * product.caseQty;
  const atFloor = value <= product.moq;
  const atCeiling = value >= ceiling;

  return (
    <div className="au-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(product.moq, value - product.caseQty))}
        disabled={atFloor}
        aria-label={`Fewer ${product.name}`}
      >
        <IconMinus size={compact ? 13 : 15} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={shown}
        aria-label={`Quantity of ${product.name}, in units`}
        onFocus={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          const parsed = Number(draft);
          onChange(Number.isFinite(parsed) ? normaliseQuantity(product, parsed) : value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        style={compact ? { width: 40, height: 32 } : undefined}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(ceiling, value + product.caseQty))}
        disabled={atCeiling}
        aria-label={`More ${product.name}`}
      >
        <IconPlus size={compact ? 13 : 15} />
      </button>
    </div>
  );
}
