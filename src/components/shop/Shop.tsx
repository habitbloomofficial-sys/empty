"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND, TERMS } from "@/lib/shop/brand";
import {
  CATALOGUE_FACTS,
  CATEGORIES,
  PRODUCTS,
  marginAt,
  stockLevel,
  type CategoryId,
  type Product,
} from "@/lib/shop/catalog";
import { group, money, moneyRound, percent } from "@/lib/shop/format";
import type { PlacedOrder } from "@/lib/shop/order";
import { useCart } from "./useCart";
import { ProductCard } from "./ProductCard";
import { ProductArt } from "./ProductArt";
import { QuickView } from "./QuickView";
import { CartDrawer } from "./CartDrawer";
import { Checkout, OrderPlaced } from "./Checkout";
import { IconCart, IconCheck, IconCloud, IconPlay, IconSearch, IconTag, IconTruck } from "./Icons";

/*
 * The shop.
 *
 * Deliberately the plainest thing in the project. The introduction is allowed
 * to be a film; this is a tool somebody uses for an hour with a stock sheet
 * open next to it, so the work here went into density and speed rather than
 * atmosphere — four numbers per card, one click to add, nothing that moves
 * unless it was asked to.
 */

type Sort = "featured" | "price-asc" | "price-desc" | "margin" | "stock" | "name";

const SORTS: [Sort, string][] = [
  ["featured", "Featured"],
  ["margin", "Highest margin"],
  ["price-asc", "Trade price, low to high"],
  ["price-desc", "Trade price, high to low"],
  ["stock", "Most in stock"],
  ["name", "Name, A–Z"],
];

const MARGIN_BANDS: [number, string][] = [
  [0, "Any margin"],
  [0.6, "60% and over"],
  [0.65, "65% and over"],
];

interface Toast {
  id: number;
  product: Product;
  quantity: number;
}

export function Shop({ onReplayIntro }: { onReplayIntro: () => void }) {
  const cart = useCart();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<Sort>("featured");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [minMargin, setMinMargin] = useState(0);

  const [openSku, setOpenSku] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bump, setBump] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // "/" is the search shortcut everywhere else; it should be here too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Anything overlaying the shop should stop the page behind it scrolling.
  useEffect(() => {
    const locked = cartOpen || Boolean(openSku) || checkout || Boolean(placed);
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen, openSku, checkout, placed]);

  const counts = useMemo(() => {
    const map = new Map<CategoryId | "all", number>([["all", PRODUCTS.length]]);
    for (const product of PRODUCTS) {
      map.set(product.category, (map.get(product.category) ?? 0) + 1);
    }
    return map;
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = PRODUCTS.filter((product) => {
      if (category !== "all" && product.category !== category) return false;
      if (inStockOnly && stockLevel(product) === "out") return false;
      if (minMargin > 0 && marginAt(product) < minMargin) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.blurb.toLowerCase().includes(needle)
      );
    });

    const by: Record<Sort, (a: Product, b: Product) => number> = {
      featured: () => 0,
      "price-asc": (a, b) => a.trade - b.trade,
      "price-desc": (a, b) => b.trade - a.trade,
      margin: (a, b) => marginAt(b) - marginAt(a),
      stock: (a, b) => b.stock - a.stock,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    if (sort !== "featured") list = [...list].sort(by[sort]);
    return list;
  }, [category, inStockOnly, minMargin, query, sort]);

  const inCart = useCallback(
    (sku: string) => cart.lines.find((line) => line.sku === sku)?.quantity ?? 0,
    [cart.lines]
  );

  const addToOrder = useCallback(
    (product: Product, quantity: number) => {
      cart.add(product.sku, quantity);
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, product, quantity }]);
      setBump(true);
      window.setTimeout(() => setBump(false), 450);
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
    },
    [cart]
  );

  const openProduct = openSku ? PRODUCTS.find((p) => p.sku === openSku) : undefined;

  if (placed) {
    return (
      <OrderPlaced
        order={placed}
        onDone={() => {
          setPlaced(null);
          setCheckout(false);
          setCartOpen(false);
        }}
      />
    );
  }

  if (checkout) {
    return <Checkout cart={cart} onBack={() => setCheckout(false)} onPlaced={setPlaced} />;
  }

  return (
    <div className="au-shop">
      <div className="au-topline">
        <div className="au-topline__inner">
          <span>
            <IconTruck /> Free carriage over <b>{moneyRound(TERMS.freeShippingFrom)}</b>
          </span>
          <span>
            <IconTag /> Volume breaks to <b>16% off trade</b>
          </span>
          <span>
            <IconCheck size={14} /> Same-day dispatch before <b>{TERMS.dispatchCutoff}</b>
          </span>
          <span>
            <IconCloud /> Orders stored in <b>{cart.storedIn === "cloud" ? "your cloud account" : "the portal"}</b>
          </span>
        </div>
      </div>

      <header className="au-header">
        <div className="au-header__inner">
          <div className="au-brand">
            <span className="au-brand__name">{BRAND.name}</span>
            <span className="au-brand__tag">{BRAND.kicker}</span>
          </div>

          <div className="au-search">
            <IconSearch />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the catalogue, or type a SKU"
              aria-label="Search the catalogue"
            />
            <kbd>/</kbd>
          </div>

          <div className="au-header__right">
            <button className="au-btn au-btn--quiet" type="button" onClick={onReplayIntro}>
              <IconPlay size={13} /> Introduction
            </button>
            <span className="au-account">
              <span className="au-account__dot" />
              Trade account · verified
            </span>
            <button
              className={`au-cartbtn${bump ? " au-cartbtn--bump" : ""}`}
              type="button"
              onClick={() => setCartOpen(true)}
            >
              <IconCart />
              <span className="au-mono">{money(cart.totals.total)}</span>
              <span className="au-cartbtn__count">{cart.totals.skuCount}</span>
            </button>
          </div>
        </div>
      </header>

      <nav className="au-rail" aria-label="Categories">
        <div className="au-rail__inner">
          <button className="au-tab" data-on={category === "all"} onClick={() => setCategory("all")} type="button">
            Everything <span className="au-tab__n">{counts.get("all")}</span>
          </button>
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              className="au-tab"
              data-on={category === entry.id}
              onClick={() => setCategory(entry.id)}
              type="button"
            >
              {entry.name} <span className="au-tab__n">{counts.get(entry.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="au-masthead">
        <div>
          <h1>{category === "all" ? "The full range" : CATEGORIES.find((c) => c.id === category)?.name}</h1>
          <p>
            {category === "all"
              ? `Every line we hold, priced for resale. Recommended retail and your margin are printed on each one, and quantities step in whole cartons so nothing arrives broken up.`
              : CATEGORIES.find((c) => c.id === category)?.blurb}
          </p>
        </div>
        <div className="au-masthead__stats">
          <div>
            <div className="au-mstat__v">{group(CATALOGUE_FACTS.lines, 0)}</div>
            <div className="au-mstat__l">Lines</div>
          </div>
          <div>
            <div className="au-mstat__v">{percent(CATALOGUE_FACTS.averageMargin)}</div>
            <div className="au-mstat__l">Avg. margin</div>
          </div>
          <div>
            <div className="au-mstat__v">{group(CATALOGUE_FACTS.unitsInStock, 0)}</div>
            <div className="au-mstat__l">Units in stock</div>
          </div>
        </div>
      </div>

      <div className="au-body">
        <aside className="au-side">
          <div className="au-side__group">
            <h3>Sort by</h3>
            <div className="au-side__list">
              {SORTS.map(([value, label]) => (
                <button
                  key={value}
                  className="au-side__item"
                  data-on={sort === value}
                  onClick={() => setSort(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="au-side__group">
            <h3>Margin</h3>
            <div className="au-side__list">
              {MARGIN_BANDS.map(([value, label]) => (
                <button
                  key={value}
                  className="au-side__item"
                  data-on={minMargin === value}
                  onClick={() => setMinMargin(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="au-side__group">
            <h3>Availability</h3>
            <label className="au-toggle">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
              <span className="au-toggle__box" />
              In stock only
            </label>
          </div>

          <div className="au-side__card">
            <h4>Trade terms</h4>
            <p>Standard terms for an approved account. Anything unusual, ask your account manager.</p>
            <dl>
              <div>
                <dt>Minimum order</dt>
                <dd>{moneyRound(TERMS.minimumOrder)}</dd>
              </div>
              <div>
                <dt>Free carriage</dt>
                <dd>{moneyRound(TERMS.freeShippingFrom)}+</dd>
              </div>
              <div>
                <dt>Carriage under that</dt>
                <dd>{money(TERMS.shippingFlat, 0)}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>Net {TERMS.netDays}</dd>
              </div>
              <div>
                <dt>VAT</dt>
                <dd>Reverse charge</dd>
              </div>
            </dl>
          </div>
        </aside>

        <main>
          <div className="au-toolbar">
            <p className="au-toolbar__count">
              <b>{visible.length}</b> {visible.length === 1 ? "line" : "lines"}
              {query && <> matching &ldquo;{query}&rdquo;</>}
            </p>
            <select
              className="au-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort"
            >
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="au-grid">
            {visible.length === 0 ? (
              <div className="au-empty">
                <h3>Nothing matches that</h3>
                <p>
                  Try a shorter search, or{" "}
                  <button
                    className="au-btn au-btn--quiet"
                    style={{ padding: 0, textDecoration: "underline" }}
                    onClick={() => {
                      setQuery("");
                      setCategory("all");
                      setMinMargin(0);
                      setInStockOnly(false);
                    }}
                    type="button"
                  >
                    clear the filters
                  </button>
                  .
                </p>
              </div>
            ) : (
              visible.map((product, i) => (
                <ProductCard
                  key={product.sku}
                  product={product}
                  index={i}
                  inCart={inCart(product.sku)}
                  onAdd={(quantity) => addToOrder(product, quantity)}
                  onOpen={() => setOpenSku(product.sku)}
                />
              ))
            )}
          </div>
        </main>
      </div>

      <footer className="au-footer">
        <div className="au-footer__inner">
          <div>
            <h4>{BRAND.full}</h4>
            <p style={{ maxWidth: 260 }}>
              Wholesale supply to retailers, gift shops, salons, hotels and online sellers across the European
              Union. Trading since {BRAND.since}.
            </p>
          </div>
          <div>
            <h4>Trade</h4>
            <div>Minimum order {moneyRound(TERMS.minimumOrder)}</div>
            <div>Free carriage over {moneyRound(TERMS.freeShippingFrom)}</div>
            <div>Net {TERMS.netDays} on approved accounts</div>
            <div>VAT reverse charge within the EU</div>
          </div>
          <div>
            <h4>Contact</h4>
            <div>
              <a href={`mailto:${BRAND.contact.email}`}>{BRAND.contact.email}</a>
            </div>
            <div>{BRAND.contact.phone}</div>
            <div style={{ maxWidth: 220 }}>{BRAND.contact.address}</div>
          </div>
          <div>
            <h4>This portal</h4>
            <div>
              <button className="au-btn au-btn--quiet" style={{ padding: 0, color: "inherit" }} onClick={onReplayIntro} type="button">
                Watch the introduction
              </button>
            </div>
            <div>Access by invitation only</div>
            <div>
              <button
                className="au-btn au-btn--quiet"
                style={{ padding: 0, color: "inherit" }}
                type="button"
                onClick={async () => {
                  await fetch("/api/shop/access", { method: "DELETE" });
                  window.location.reload();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
        <div className="au-footer__bar">
          <span>
            © {BRAND.since}–{new Date().getFullYear()} {BRAND.full}. Trade prices are confidential.
          </span>
          <span>
            Example catalogue · {CATALOGUE_FACTS.lines} placeholder lines
          </span>
        </div>
      </footer>

      {openProduct && (
        <QuickView
          product={openProduct}
          inCart={inCart(openProduct.sku)}
          onAdd={(quantity) => addToOrder(openProduct, quantity)}
          onClose={() => setOpenSku(null)}
        />
      )}

      {cartOpen && (
        <CartDrawer
          cart={cart}
          onClose={() => setCartOpen(false)}
          onCheckout={() => {
            setCartOpen(false);
            setCheckout(true);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="au-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div className="au-toast" key={toast.id}>
              <span className="au-toast__art">
                <ProductArt art={toast.product.art} tone={toast.product.tone} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>Added to your order</b>
                <small>
                  {group(toast.quantity, 0)} × {toast.product.name}
                </small>
              </span>
              <button
                className="au-btn au-btn--sm"
                style={{ color: "var(--gold-bright)" }}
                onClick={() => setCartOpen(true)}
                type="button"
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
