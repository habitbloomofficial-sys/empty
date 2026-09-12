import { getSetting } from "./settings";

// His Shopify store, read-only.
//
// Everything here asks questions and nothing here answers for him. There is no
// refund, no cancellation, no price change, no fulfilment — not because the API
// lacks them, but because "check my store" is what he asked for, and a mistake
// in this file with a write in it costs a customer's money rather than a wasted
// second. If he wants Jarvis to change something in the shop, that is a separate
// decision made out loud, not a capability that arrives quietly alongside
// reading the order list.
//
// The Admin GraphQL API rather than REST: REST is deprecated for new work, and
// one GraphQL round trip fetches an order with its line items and its customer
// where REST needs three.

const API_VERSION = "2025-01";

/**
 * The store's myshopify.com host, however he wrote it down.
 *
 * People paste the admin URL, or the custom domain, or just the handle. Only
 * the myshopify host authenticates, so anything else is reduced to it — and a
 * custom domain cannot be, which is worth saying rather than failing later
 * with "401".
 */
export function storeHost(): string | null {
  const raw = getSetting("SHOPIFY_STORE")?.trim();
  if (!raw) return null;

  const value = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!value) return null;
  if (value.endsWith(".myshopify.com")) return value;
  // A bare handle is the common case: "casper-shop".
  if (/^[a-z0-9][a-z0-9-]*$/.test(value)) return `${value}.myshopify.com`;
  return null;
}

function token(): string | null {
  return getSetting("SHOPIFY_TOKEN")?.trim() || null;
}

export function isShopifyConfigured(): boolean {
  return Boolean(storeHost() && token());
}

/** What went wrong, in words rather than a status code. */
function explain(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return (
      "Shopify wouldn't accept the access token, sir. It needs to be an Admin API " +
      "access token from a custom app (it begins shpat_), and that app needs read " +
      "access to orders and products."
    );
  }
  if (status === 404) {
    return `Shopify has no store at ${storeHost()}, sir — check the store address in Settings.`;
  }
  if (status === 429) return "Shopify is rate-limiting us, sir. A moment and I'll try again.";
  return `Shopify returned ${status}, sir.${body ? ` It said: ${body.slice(0, 200)}` : ""}`;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function query<T>(gql: string, variables: Record<string, unknown> = {}): Promise<T> {
  const host = storeHost();
  const key = token();
  if (!host || !key) {
    throw new Error(
      "The Shopify store isn't connected yet, sir — the store address and an Admin API " +
        "access token go in Settings."
    );
  }

  const response = await fetch(`https://${host}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": key,
    },
    body: JSON.stringify({ query: gql, variables }),
    // A shop that doesn't answer in fifteen seconds isn't going to.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(explain(response.status, await response.text().catch(() => "")));

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    // A missing scope arrives here as a normal 200 with an error in the body,
    // which is the single most likely thing to go wrong on a new custom app.
    const message = payload.errors.map((error) => error.message).join("; ");
    if (/access denied|scope/i.test(message)) {
      throw new Error(
        `Shopify refused that, sir: ${message}. The custom app needs read_orders, ` +
          "read_products and read_customers ticked."
      );
    }
    throw new Error(`Shopify said: ${message}`);
  }
  if (!payload.data) throw new Error("Shopify sent an empty answer, sir.");
  return payload.data;
}

// --- shape of what comes back ---------------------------------------------

export interface Money {
  amount: number;
  currency: string;
}

export interface OrderLine {
  title: string;
  quantity: number;
}

export interface ShopOrder {
  /** The order number as he'd say it — "#1042". */
  name: string;
  createdAt: string;
  customer: string | null;
  total: Money;
  financial: string | null;
  fulfilment: string | null;
  lines: OrderLine[];
  /** Where to look at it in the admin. */
  url: string | null;
}

export interface ShopInfo {
  name: string;
  host: string;
  currency: string;
  email: string | null;
  plan: string | null;
}

interface RawMoney {
  shopMoney: { amount: string; currencyCode: string };
}

interface RawOrder {
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: RawMoney;
  customer: { displayName: string | null } | null;
  lineItems: { nodes: { title: string; quantity: number }[] };
}

function money(raw: RawMoney): Money {
  return { amount: Number(raw.shopMoney.amount), currency: raw.shopMoney.currencyCode };
}

/** Shopify's SCREAMING_CASE turned into something a butler would say. */
function phrase(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/_/g, " ");
}

function toOrder(raw: RawOrder): ShopOrder {
  const host = storeHost();
  return {
    name: raw.name,
    createdAt: raw.createdAt,
    customer: raw.customer?.displayName ?? null,
    total: money(raw.totalPriceSet),
    financial: phrase(raw.displayFinancialStatus),
    fulfilment: phrase(raw.displayFulfillmentStatus),
    lines: raw.lineItems.nodes.map((line) => ({ title: line.title, quantity: line.quantity })),
    url: host ? `https://${host}/admin/orders` : null,
  };
}

const ORDER_FIELDS = `
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName }
  lineItems(first: 20) { nodes { title quantity } }
`;

// --- the questions he actually asks ---------------------------------------

export async function shopInfo(): Promise<ShopInfo> {
  const data = await query<{
    shop: {
      name: string;
      myshopifyDomain: string;
      currencyCode: string;
      email: string | null;
      plan: { displayName: string } | null;
    };
  }>(`{ shop { name myshopifyDomain currencyCode email plan { displayName } } }`);

  return {
    name: data.shop.name,
    host: data.shop.myshopifyDomain,
    currency: data.shop.currencyCode,
    email: data.shop.email,
    plan: data.shop.plan?.displayName ?? null,
  };
}

export interface OrdersParams {
  limit?: number;
  /** Only the ones still to go out. */
  unfulfilledOnly?: boolean;
  /** Only orders placed in the last N days. */
  sinceDays?: number;
}

export async function recentOrders(params: OrdersParams = {}): Promise<ShopOrder[]> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);

  const filters: string[] = [];
  if (params.unfulfilledOnly) filters.push("fulfillment_status:unfulfilled");
  if (params.sinceDays && params.sinceDays > 0) {
    const since = new Date(Date.now() - params.sinceDays * 86_400_000);
    filters.push(`created_at:>=${since.toISOString().slice(0, 10)}`);
  }

  const data = await query<{ orders: { nodes: RawOrder[] } }>(
    `query Orders($first: Int!, $q: String) {
       orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $q) {
         nodes { ${ORDER_FIELDS} }
       }
     }`,
    { first: limit, q: filters.join(" AND ") || null }
  );
  return data.orders.nodes.map(toOrder);
}

/** One order, by the number he reads off an email — "#1042", "1042". */
export async function findOrder(reference: string): Promise<ShopOrder | null> {
  const tidy = reference.trim().replace(/^#/, "");
  if (!tidy) return null;

  const data = await query<{ orders: { nodes: RawOrder[] } }>(
    `query FindOrder($q: String!) {
       orders(first: 5, query: $q) { nodes { ${ORDER_FIELDS} } }
     }`,
    { q: `name:${JSON.stringify(tidy)}` }
  );
  const found = data.orders.nodes.map(toOrder);
  // Shopify matches loosely, so prefer an exact number when one came back.
  return found.find((order) => order.name.replace(/^#/, "") === tidy) ?? found[0] ?? null;
}

export interface SalesSummary {
  days: number;
  orders: number;
  total: Money;
  unfulfilled: number;
}

/**
 * What the shop has taken over a period.
 *
 * Summed here rather than through the analytics API on purpose: this counts
 * exactly the orders it also lists, so the total always agrees with the orders
 * he can see next to it. A number from a different source that disagrees by one
 * order is worse than no number.
 */
export async function salesSummary(days = 7): Promise<SalesSummary> {
  const orders = await recentOrders({ limit: 50, sinceDays: days });
  const currency = orders[0]?.total.currency ?? "";
  const amount = orders.reduce((sum, order) => sum + order.total.amount, 0);
  return {
    days,
    orders: orders.length,
    total: { amount: Math.round(amount * 100) / 100, currency },
    unfulfilled: orders.filter((order) => order.fulfilment === "unfulfilled").length,
  };
}

export interface ShopProduct {
  title: string;
  status: string;
  totalStock: number | null;
  price: Money | null;
}

export async function searchShopProducts(text: string, limit = 10): Promise<ShopProduct[]> {
  const data = await query<{
    products: {
      nodes: {
        title: string;
        status: string;
        totalInventory: number | null;
        priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
      }[];
    };
  }>(
    `query Products($first: Int!, $q: String) {
       products(first: $first, query: $q) {
         nodes {
           title
           status
           totalInventory
           priceRangeV2 { minVariantPrice { amount currencyCode } }
         }
       }
     }`,
    { first: Math.min(Math.max(limit, 1), 50), q: text.trim() || null }
  );

  return data.products.nodes.map((node) => ({
    title: node.title,
    status: node.status.toLowerCase(),
    totalStock: node.totalInventory,
    price: {
      amount: Number(node.priceRangeV2.minVariantPrice.amount),
      currency: node.priceRangeV2.minVariantPrice.currencyCode,
    },
  }));
}

/** What is about to run out. */
export async function lowStock(threshold = 5, limit = 20): Promise<ShopProduct[]> {
  const products = await searchShopProducts("", 50);
  return products
    .filter((product) => product.totalStock !== null && product.totalStock <= threshold)
    .sort((a, b) => (a.totalStock ?? 0) - (b.totalStock ?? 0))
    .slice(0, limit);
}
