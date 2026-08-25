import { TERMS } from "./brand";
import { PRODUCTS, findProduct, unitPriceAt, type Product } from "./catalog";

/*
 * Order maths, in one place because both sides need it.
 *
 * The browser needs it to keep the cart total live as you click, and the server
 * needs it because a price that arrived from a browser is a suggestion, not a
 * price. Same functions, same answers, and the server's answer is the one that
 * ends up on the purchase order.
 */

export interface CartLine {
  sku: string;
  quantity: number;
}

export interface PricedLine {
  product: Product;
  quantity: number;
  /** After volume breaks. */
  unit: number;
  /** unit x quantity. */
  net: number;
  /** What the line would have cost at list trade price. */
  list: number;
  /** list - net. */
  saved: number;
  /** What the whole line is worth on the reseller's shelf. */
  retail: number;
}

export interface Totals {
  lines: PricedLine[];
  /** Distinct SKUs. */
  skuCount: number;
  /** Units across every line. */
  unitCount: number;
  /** Sum of line nets. */
  goods: number;
  /** Volume discount already reflected in `goods`. */
  volumeSaved: number;
  shipping: number;
  total: number;
  /** Combined RRP of everything in the cart. */
  retailValue: number;
  /** retailValue - goods. */
  profit: number;
  /** profit / retailValue. */
  margin: number;
  /** Whether the order clears the minimum. */
  meetsMinimum: boolean;
  /** How much more is needed for free carriage, or 0. */
  toFreeShipping: number;
}

/** Round the way an invoice does, not the way a float does. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Quantities must land on a whole carton, at or above the MOQ. */
export function normaliseQuantity(product: Product, requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const stepped = Math.round(requested / product.caseQty) * product.caseQty;
  const atLeastMoq = Math.max(stepped, product.moq);
  // Never promise stock that isn't there.
  const capped = Math.min(atLeastMoq, Math.floor(product.stock / product.caseQty) * product.caseQty);
  return Math.max(0, capped);
}

/** Throw away anything that isn't a real SKU before it reaches the maths. */
export function sanitiseCart(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const clean: CartLine[] = [];
  for (const entry of input.slice(0, PRODUCTS.length)) {
    const line = entry as { sku?: unknown; quantity?: unknown };
    if (typeof line?.sku !== "string" || seen.has(line.sku)) continue;
    const product = findProduct(line.sku);
    if (!product) continue;
    const quantity = normaliseQuantity(product, Number(line.quantity));
    if (quantity <= 0) continue;
    seen.add(line.sku);
    clean.push({ sku: product.sku, quantity });
  }
  return clean;
}

export function priceCart(cart: CartLine[]): Totals {
  const lines: PricedLine[] = [];

  for (const line of cart) {
    const product = findProduct(line.sku);
    if (!product) continue;
    const unit = unitPriceAt(product, line.quantity);
    const net = cents(unit * line.quantity);
    const list = cents(product.trade * line.quantity);
    lines.push({
      product,
      quantity: line.quantity,
      unit,
      net,
      list,
      saved: cents(list - net),
      retail: cents(product.rrp * line.quantity),
    });
  }

  const goods = cents(lines.reduce((sum, l) => sum + l.net, 0));
  const volumeSaved = cents(lines.reduce((sum, l) => sum + l.saved, 0));
  const retailValue = cents(lines.reduce((sum, l) => sum + l.retail, 0));
  const unitCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const shipping = goods === 0 || goods >= TERMS.freeShippingFrom ? 0 : TERMS.shippingFlat;
  const profit = cents(retailValue - goods);

  return {
    lines,
    skuCount: lines.length,
    unitCount,
    goods,
    volumeSaved,
    shipping,
    total: cents(goods + shipping),
    retailValue,
    profit,
    margin: retailValue > 0 ? profit / retailValue : 0,
    meetsMinimum: goods >= TERMS.minimumOrder,
    toFreeShipping: goods > 0 ? Math.max(0, cents(TERMS.freeShippingFrom - goods)) : TERMS.freeShippingFrom,
  };
}

// --- purchase orders --------------------------------------------------------

export interface BuyerDetails {
  company: string;
  vat: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
  reference: string;
  notes: string;
}

export interface PlacedOrder {
  reference: string;
  placedAt: string;
  buyer: BuyerDetails;
  lines: { sku: string; name: string; quantity: number; unit: number; net: number }[];
  goods: number;
  shipping: number;
  total: number;
  retailValue: number;
  profit: number;
  unitCount: number;
  /** Where this record was written — cloud store or server memory. */
  storedIn: "cloud" | "memory";
}

/** AUR-7K2QF9 — short enough to read down a phone, unique enough to file. */
export function orderReference(seed = Date.now(), noise = Math.random()): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let value = Math.abs(Math.floor(seed / 1000) * 1000 + Math.floor(noise * 1000));
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out = alphabet[value % alphabet.length] + out;
    value = Math.floor(value / alphabet.length);
  }
  return `AUR-${out}`;
}

const REQUIRED: (keyof BuyerDetails)[] = ["company", "contact", "email", "address", "city", "postcode", "country"];

/** Which required fields are still blank. */
export function missingDetails(buyer: Partial<BuyerDetails>): (keyof BuyerDetails)[] {
  return REQUIRED.filter((field) => !String(buyer[field] ?? "").trim());
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Trim and cap everything a buyer typed, before it is stored or invoiced. */
export function sanitiseBuyer(input: unknown): BuyerDetails {
  const raw = (input ?? {}) as Record<string, unknown>;
  const field = (name: string, max = 160) => String(raw[name] ?? "").trim().slice(0, max);
  return {
    company: field("company"),
    vat: field("vat", 32),
    contact: field("contact"),
    email: field("email"),
    phone: field("phone", 40),
    address: field("address", 240),
    city: field("city"),
    postcode: field("postcode", 24),
    country: field("country"),
    reference: field("reference", 64),
    notes: field("notes", 600),
  };
}
