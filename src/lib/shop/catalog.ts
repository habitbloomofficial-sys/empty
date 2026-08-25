/*
 * The catalogue.
 *
 * These thirty lines are placeholders — the client's real range isn't decided
 * yet — but the *shape* of them is not a placeholder. Every field here is one a
 * reseller actually needs before committing to a purchase order: what it costs
 * them, what it sells for, how many they have to take, how many exist, and how
 * long until it's on their shelf. Swapping in the real range means replacing
 * the PRODUCTS array and nothing else.
 */

export type CategoryId = "home" | "wellness" | "kitchen" | "tech" | "outdoor" | "paper";

export interface Category {
  id: CategoryId;
  name: string;
  blurb: string;
}

export const CATEGORIES: Category[] = [
  { id: "home", name: "Home & Living", blurb: "Lighting, ceramics and textiles with a long shelf life." },
  { id: "wellness", name: "Wellness & Beauty", blurb: "Clean formulations, high repeat purchase, strong margin." },
  { id: "kitchen", name: "Kitchen & Dining", blurb: "Heavy, tactile pieces that justify their price in the hand." },
  { id: "tech", name: "Tech & Accessories", blurb: "Everyday electronics with the packaging done properly." },
  { id: "outdoor", name: "Outdoor & Travel", blurb: "Built for weather. Sells hardest from March to August." },
  { id: "paper", name: "Gifts & Stationery", blurb: "Low unit cost, high attachment rate at the till." },
];

/** A volume break: from this many units, take this much off the trade price. */
export interface Tier {
  from: number;
  discount: number;
}

export type Badge = "bestseller" | "new" | "limited" | "restocked";

/** Which illustration stands in for the product. See ProductArt. */
export type ArtKey =
  | "lamp" | "vase" | "throw" | "cushion" | "candle"
  | "diffuser" | "serum" | "oil" | "soap" | "balm"
  | "board" | "knife" | "pan" | "cutlery" | "glass"
  | "speaker" | "headphones" | "charger" | "cable" | "watch"
  | "backpack" | "flask" | "umbrella" | "towel" | "mug"
  | "notebook" | "pen" | "cards" | "frame" | "giftbox";

/** Colourway. Keeps thirty illustrations from reading as one grey blur. */
export type ToneKey = "sand" | "clay" | "sage" | "slate" | "ink" | "plum" | "ocean" | "brass";

export interface Product {
  sku: string;
  name: string;
  category: CategoryId;
  blurb: string;
  art: ArtKey;
  tone: ToneKey;
  /** What the reseller pays, per unit, before volume breaks. */
  trade: number;
  /** Recommended retail, per unit, excluding VAT. */
  rrp: number;
  /** Units per inner carton. Orders step in these. */
  caseQty: number;
  /** Minimum order quantity, in units. */
  moq: number;
  /** Units in the warehouse right now. */
  stock: number;
  /** Working days to dispatch when in stock. */
  leadDays: number;
  badge?: Badge;
  tiers: Tier[];
  specs: [string, string][];
}

/** The standard volume ladder, expressed in cartons rather than loose units. */
function ladder(caseQty: number): Tier[] {
  return [
    { from: caseQty * 4, discount: 0.05 },
    { from: caseQty * 10, discount: 0.1 },
    { from: caseQty * 25, discount: 0.16 },
  ];
}

export const PRODUCTS: Product[] = [
  // --- Home & Living -------------------------------------------------------
  {
    sku: "HL-101", name: "Lumen Ribbed Glass Table Lamp", category: "home",
    blurb: "Hand-blown ribbed shade on a solid brass base. Dimmable, E14, EU plug.",
    art: "lamp", tone: "brass", trade: 34.5, rrp: 89, caseQty: 4, moq: 8, stock: 1840,
    leadDays: 2, badge: "bestseller", tiers: ladder(4),
    specs: [["Material", "Blown glass, solid brass"], ["Height", "38 cm"], ["Fitting", "E14, max 25 W"], ["Certification", "CE, RoHS"], ["Carton", "4 units, 6.2 kg"]],
  },
  {
    sku: "HL-102", name: "Terra Stoneware Vase, Large", category: "home",
    blurb: "Reactive glaze over dark stoneware. No two finish identically.",
    art: "vase", tone: "clay", trade: 18.9, rrp: 49, caseQty: 6, moq: 12, stock: 960,
    leadDays: 2, tiers: ladder(6),
    specs: [["Material", "Glazed stoneware"], ["Height", "31 cm"], ["Finish", "Reactive, food-safe"], ["Care", "Hand wash"], ["Carton", "6 units, 9.4 kg"]],
  },
  {
    sku: "HL-103", name: "Alpine Lambswool Throw", category: "home",
    blurb: "Woven in Portugal from 100% lambswool. Herringbone, fringed edge.",
    art: "throw", tone: "sand", trade: 41, rrp: 115, caseQty: 4, moq: 8, stock: 420,
    leadDays: 4, badge: "limited", tiers: ladder(4),
    specs: [["Material", "100% lambswool"], ["Size", "130 × 180 cm"], ["Weight", "1.1 kg"], ["Origin", "Portugal"], ["Carton", "4 units, 5.0 kg"]],
  },
  {
    sku: "HL-104", name: "Washed Linen Cushion Cover", category: "home",
    blurb: "Stonewashed European flax, hidden zip. Four colourways, ships mixed.",
    art: "cushion", tone: "sage", trade: 11.4, rrp: 32, caseQty: 10, moq: 20, stock: 3100,
    leadDays: 2, tiers: ladder(10),
    specs: [["Material", "100% washed linen"], ["Size", "50 × 50 cm"], ["Closure", "Hidden zip"], ["Care", "Machine wash 30°"], ["Carton", "10 units, 2.8 kg"]],
  },
  {
    sku: "HL-105", name: "Noir Ceramic Candle, 220 g", category: "home",
    blurb: "Coconut-soy wax, cedar and black fig. 45-hour burn, refillable vessel.",
    art: "candle", tone: "ink", trade: 9.8, rrp: 28, caseQty: 12, moq: 24, stock: 5400,
    leadDays: 1, badge: "bestseller", tiers: ladder(12),
    specs: [["Wax", "Coconut-soy blend"], ["Burn time", "45 hours"], ["Scent", "Cedar, black fig"], ["Vessel", "Glazed ceramic, refillable"], ["Carton", "12 units, 4.6 kg"]],
  },

  // --- Wellness & Beauty ---------------------------------------------------
  {
    sku: "WB-201", name: "Botanic Reed Diffuser, 200 ml", category: "wellness",
    blurb: "Eight rattan reeds, 16-week throw. Bergamot, vetiver, white amber.",
    art: "diffuser", tone: "sage", trade: 12.6, rrp: 36, caseQty: 8, moq: 16, stock: 2250,
    leadDays: 2, tiers: ladder(8),
    specs: [["Volume", "200 ml"], ["Longevity", "Up to 16 weeks"], ["Base", "Plant-derived, IFRA compliant"], ["Reeds", "8 natural rattan"], ["Carton", "8 units, 3.9 kg"]],
  },
  {
    sku: "WB-202", name: "Hydra Vitamin C Serum, 30 ml", category: "wellness",
    blurb: "10% stabilised ascorbate with hyaluronic acid. Airless violet glass.",
    art: "serum", tone: "plum", trade: 14.2, rrp: 45, caseQty: 12, moq: 24, stock: 1680,
    leadDays: 2, badge: "new", tiers: ladder(12),
    specs: [["Volume", "30 ml"], ["Active", "10% stabilised vitamin C"], ["Packaging", "Airless violet glass"], ["Shelf life", "24 months sealed"], ["Carton", "12 units, 2.4 kg"]],
  },
  {
    sku: "WB-203", name: "Cold-Pressed Body Oil, 100 ml", category: "wellness",
    blurb: "Jojoba, rosehip and sweet almond. Unfragranced, dermatologist tested.",
    art: "oil", tone: "brass", trade: 10.4, rrp: 29, caseQty: 12, moq: 24, stock: 2980,
    leadDays: 1, tiers: ladder(12),
    specs: [["Volume", "100 ml"], ["Base", "Jojoba, rosehip, almond"], ["Fragrance", "None"], ["Testing", "Dermatologist tested"], ["Carton", "12 units, 1.9 kg"]],
  },
  {
    sku: "WB-204", name: "Charcoal Cleansing Bar, 120 g", category: "wellness",
    blurb: "Cold-process, activated charcoal, plastic-free wrap. Shelf-stable 3 years.",
    art: "soap", tone: "ink", trade: 4.2, rrp: 13, caseQty: 24, moq: 48, stock: 8600,
    leadDays: 1, badge: "bestseller", tiers: ladder(24),
    specs: [["Weight", "120 g"], ["Process", "Cold-process, cured 6 weeks"], ["Packaging", "Plastic-free, FSC card"], ["Shelf life", "36 months"], ["Carton", "24 units, 3.4 kg"]],
  },
  {
    sku: "WB-205", name: "Repair Hand Balm, 75 ml", category: "wellness",
    blurb: "Shea and ceramide balm in an aluminium tube. The counter-top impulse buy.",
    art: "balm", tone: "sand", trade: 5.6, rrp: 16, caseQty: 24, moq: 48, stock: 6400,
    leadDays: 1, tiers: ladder(24),
    specs: [["Volume", "75 ml"], ["Key actives", "Shea butter, ceramide NP"], ["Tube", "Recyclable aluminium"], ["Absorption", "Non-greasy"], ["Carton", "24 units, 2.6 kg"]],
  },

  // --- Kitchen & Dining ----------------------------------------------------
  {
    sku: "KD-301", name: "Acacia End-Grain Board, 40 cm", category: "kitchen",
    blurb: "End-grain construction, juice groove, recessed handles. Oiled finish.",
    art: "board", tone: "brass", trade: 22.8, rrp: 62, caseQty: 6, moq: 12, stock: 1120,
    leadDays: 3, tiers: ladder(6),
    specs: [["Material", "FSC acacia, end-grain"], ["Size", "40 × 28 × 3.5 cm"], ["Weight", "2.3 kg"], ["Finish", "Food-safe mineral oil"], ["Carton", "6 units, 14.5 kg"]],
  },
  {
    sku: "KD-302", name: "Damascus Chef's Knife, 20 cm", category: "kitchen",
    blurb: "67-layer VG-10 core, 60 HRC, pakkawood handle. Presentation box included.",
    art: "knife", tone: "slate", trade: 48, rrp: 139, caseQty: 4, moq: 4, stock: 380,
    leadDays: 4, badge: "limited", tiers: ladder(4),
    specs: [["Steel", "67-layer damascus, VG-10 core"], ["Hardness", "60 ± 1 HRC"], ["Blade", "20 cm"], ["Handle", "Stabilised pakkawood"], ["Carton", "4 units, 3.2 kg"]],
  },
  {
    sku: "KD-303", name: "Cast Iron Skillet, 26 cm", category: "kitchen",
    blurb: "Pre-seasoned, oven to table, helper handle. Effectively a lifetime product.",
    art: "pan", tone: "ink", trade: 19.5, rrp: 54, caseQty: 4, moq: 8, stock: 1460,
    leadDays: 2, tiers: ladder(4),
    specs: [["Material", "Pre-seasoned cast iron"], ["Diameter", "26 cm"], ["Weight", "3.9 kg"], ["Compatible", "Induction, gas, oven"], ["Carton", "4 units, 16.4 kg"]],
  },
  {
    sku: "KD-304", name: "Matte Black Cutlery Set, 16 pc", category: "kitchen",
    blurb: "18/10 stainless with PVD coating. Dishwasher safe, four place settings.",
    art: "cutlery", tone: "ink", trade: 26.4, rrp: 75, caseQty: 6, moq: 6, stock: 890,
    leadDays: 3, badge: "restocked", tiers: ladder(6),
    specs: [["Material", "18/10 stainless, PVD"], ["Pieces", "16 (4 settings)"], ["Dishwasher", "Safe"], ["Finish", "Matte black"], ["Carton", "6 units, 9.8 kg"]],
  },
  {
    sku: "KD-305", name: "Double-Wall Espresso Glass, 4 pk", category: "kitchen",
    blurb: "Borosilicate, 80 ml. Keeps the shot hot and the fingers cool.",
    art: "glass", tone: "ocean", trade: 13.2, rrp: 38, caseQty: 8, moq: 16, stock: 2040,
    leadDays: 2, tiers: ladder(8),
    specs: [["Material", "Borosilicate glass"], ["Volume", "80 ml each"], ["Pack", "4 glasses"], ["Dishwasher", "Safe"], ["Carton", "8 packs, 5.1 kg"]],
  },

  // --- Tech & Accessories --------------------------------------------------
  {
    sku: "TA-401", name: "Field Bluetooth Speaker", category: "tech",
    blurb: "IP67, 24-hour battery, USB-C, pairs in stereo. Recycled aluminium shell.",
    art: "speaker", tone: "slate", trade: 38.5, rrp: 99, caseQty: 6, moq: 6, stock: 1240,
    leadDays: 3, badge: "bestseller", tiers: ladder(6),
    specs: [["Battery", "24 h at 50% volume"], ["Rating", "IP67 dust and water"], ["Output", "2 × 10 W"], ["Charging", "USB-C, 2.5 h"], ["Carton", "6 units, 4.8 kg"]],
  },
  {
    sku: "TA-402", name: "Studio Over-Ear Headphones", category: "tech",
    blurb: "40 mm drivers, hybrid ANC, 40-hour battery, memory-foam ear cushions.",
    art: "headphones", tone: "ink", trade: 52, rrp: 149, caseQty: 4, moq: 4, stock: 640,
    leadDays: 4, badge: "new", tiers: ladder(4),
    specs: [["Drivers", "40 mm dynamic"], ["ANC", "Hybrid, -32 dB"], ["Battery", "40 h ANC off"], ["Codecs", "SBC, AAC, LDAC"], ["Carton", "4 units, 3.6 kg"]],
  },
  {
    sku: "TA-403", name: "3-in-1 Wireless Charge Pad", category: "tech",
    blurb: "Qi2 15 W, folds flat. Phone, watch and buds from one adapter.",
    art: "charger", tone: "slate", trade: 21.6, rrp: 59, caseQty: 10, moq: 10, stock: 1980,
    leadDays: 2, tiers: ladder(10),
    specs: [["Standard", "Qi2 magnetic, 15 W"], ["Devices", "Phone, watch, earbuds"], ["Form", "Folding travel case"], ["Included", "35 W USB-C adapter"], ["Carton", "10 units, 4.2 kg"]],
  },
  {
    sku: "TA-404", name: "Braided USB-C Cable, 2 m", category: "tech",
    blurb: "240 W PD, 480 Mbps, aramid core. The everyday attachment sale.",
    art: "cable", tone: "sand", trade: 4.8, rrp: 15, caseQty: 25, moq: 50, stock: 9200,
    leadDays: 1, tiers: ladder(25),
    specs: [["Power", "240 W USB-PD 3.1"], ["Data", "480 Mbps"], ["Length", "2 m"], ["Jacket", "Braided nylon, aramid core"], ["Carton", "25 units, 2.9 kg"]],
  },
  {
    sku: "TA-405", name: "Minimalist Quartz Watch, 38 mm", category: "tech",
    blurb: "Sapphire crystal, Swiss movement, quick-release strap. Gift-boxed.",
    art: "watch", tone: "brass", trade: 44, rrp: 129, caseQty: 6, moq: 6, stock: 520,
    leadDays: 5, tiers: ladder(6),
    specs: [["Movement", "Swiss quartz, Ronda"], ["Crystal", "Sapphire, AR-coated"], ["Case", "38 mm, 316L steel"], ["Water", "5 ATM"], ["Carton", "6 units, 2.1 kg"]],
  },

  // --- Outdoor & Travel ----------------------------------------------------
  {
    sku: "OT-501", name: "Roll-Top Canvas Backpack, 22 L", category: "outdoor",
    blurb: "Waxed cotton, leather trim, padded 16\" laptop sleeve. Ages beautifully.",
    art: "backpack", tone: "brass", trade: 39.5, rrp: 110, caseQty: 4, moq: 8, stock: 760,
    leadDays: 4, tiers: ladder(4),
    specs: [["Material", "18 oz waxed cotton"], ["Volume", "22 L, roll-top"], ["Laptop", "Fits 16 inch"], ["Trim", "Vegetable-tanned leather"], ["Carton", "4 units, 5.4 kg"]],
  },
  {
    sku: "OT-502", name: "Insulated Steel Flask, 750 ml", category: "outdoor",
    blurb: "Double-wall 18/8, 24 h cold and 12 h hot. Powder-coated, leakproof.",
    art: "flask", tone: "ocean", trade: 13.8, rrp: 39, caseQty: 12, moq: 24, stock: 4300,
    leadDays: 1, badge: "bestseller", tiers: ladder(12),
    specs: [["Material", "18/8 stainless, double-wall"], ["Volume", "750 ml"], ["Retention", "24 h cold, 12 h hot"], ["Finish", "Powder coat"], ["Carton", "12 units, 5.6 kg"]],
  },
  {
    sku: "OT-503", name: "Storm Compact Umbrella", category: "outdoor",
    blurb: "Fibreglass ribs to 110 km/h, automatic open-close, 28 cm folded.",
    art: "umbrella", tone: "slate", trade: 9.2, rrp: 27, caseQty: 12, moq: 24, stock: 3600,
    leadDays: 2, tiers: ladder(12),
    specs: [["Ribs", "9 fibreglass, wind-tested"], ["Span", "98 cm open"], ["Folded", "28 cm, 340 g"], ["Action", "Automatic open-close"], ["Carton", "12 units, 4.4 kg"]],
  },
  {
    sku: "OT-504", name: "Sand-Free Beach Towel, XL", category: "outdoor",
    blurb: "Recycled microfibre, dries in 20 minutes, packs to the size of a fist.",
    art: "towel", tone: "ocean", trade: 8.4, rrp: 25, caseQty: 12, moq: 24, stock: 5200,
    leadDays: 1, tiers: ladder(12),
    specs: [["Material", "Recycled microfibre"], ["Size", "180 × 90 cm"], ["Dry time", "~20 minutes"], ["Packed", "16 × 9 cm"], ["Carton", "12 units, 3.8 kg"]],
  },
  {
    sku: "OT-505", name: "Trail Enamel Mug, 400 ml", category: "outdoor",
    blurb: "Speckled porcelain enamel over steel. Campfire safe, stacks tight.",
    art: "mug", tone: "sage", trade: 5.9, rrp: 18, caseQty: 24, moq: 24, stock: 7100,
    leadDays: 1, tiers: ladder(24),
    specs: [["Material", "Enamel over steel"], ["Volume", "400 ml"], ["Heat", "Campfire and oven safe"], ["Finish", "Speckled, rolled rim"], ["Carton", "24 units, 7.2 kg"]],
  },

  // --- Gifts & Stationery --------------------------------------------------
  {
    sku: "GS-601", name: "Hardcover Dot-Grid Notebook, A5", category: "paper",
    blurb: "120 gsm ivory stock, lay-flat binding, elastic and ribbon. 192 pages.",
    art: "notebook", tone: "ink", trade: 7.2, rrp: 22, caseQty: 20, moq: 20, stock: 6800,
    leadDays: 1, badge: "bestseller", tiers: ladder(20),
    specs: [["Paper", "120 gsm, FSC ivory"], ["Pages", "192, dot grid"], ["Binding", "Lay-flat sewn"], ["Format", "A5, 148 × 210 mm"], ["Carton", "20 units, 8.2 kg"]],
  },
  {
    sku: "GS-602", name: "Brass Fineliner Pen, 0.5 mm", category: "paper",
    blurb: "Solid brass barrel that patinas with use. Refillable, standard D1.",
    art: "pen", tone: "brass", trade: 8.6, rrp: 26, caseQty: 20, moq: 20, stock: 2400,
    leadDays: 2, tiers: ladder(20),
    specs: [["Barrel", "Solid brass, 42 g"], ["Nib", "0.5 mm"], ["Refill", "Standard D1"], ["Packaging", "Kraft sleeve"], ["Carton", "20 units, 1.4 kg"]],
  },
  {
    sku: "GS-603", name: "Letterpress Card Set, 12 pc", category: "paper",
    blurb: "Cotton stock, deep-impression letterpress, kraft envelopes. Blank inside.",
    art: "cards", tone: "sand", trade: 6.4, rrp: 19, caseQty: 20, moq: 40, stock: 4100,
    leadDays: 2, tiers: ladder(20),
    specs: [["Stock", "300 gsm cotton"], ["Print", "Letterpress, 2 colour"], ["Set", "12 cards, 12 envelopes"], ["Size", "A6 folded"], ["Carton", "20 sets, 5.6 kg"]],
  },
  {
    sku: "GS-604", name: "Oak Photo Frame, 13 × 18 cm", category: "paper",
    blurb: "Solid European oak, museum-grade acrylic. Wall or free-standing.",
    art: "frame", tone: "sand", trade: 9.9, rrp: 29, caseQty: 12, moq: 24, stock: 3300,
    leadDays: 2, tiers: ladder(12),
    specs: [["Material", "Solid European oak"], ["Aperture", "13 × 18 cm"], ["Glazing", "Museum-grade acrylic"], ["Mount", "Wall or easel"], ["Carton", "12 units, 6.0 kg"]],
  },
  {
    sku: "GS-605", name: "Kraft Gift Box, Set of 10", category: "paper",
    blurb: "Rigid FSC board, magnetic closure, flat-packed. Own-brand ready.",
    art: "giftbox", tone: "clay", trade: 11.8, rrp: 34, caseQty: 10, moq: 20, stock: 2700,
    leadDays: 2, badge: "new", tiers: ladder(10),
    specs: [["Board", "Rigid FSC kraft, 1200 gsm"], ["Closure", "Magnetic flap"], ["Sizes", "Nested, 3 sizes"], ["Branding", "Foil or emboss to order"], ["Carton", "10 sets, 6.4 kg"]],
  },
];

// --- derived numbers --------------------------------------------------------

/** Unit price at a given quantity, after volume breaks. */
export function unitPriceAt(product: Product, quantity: number): number {
  let price = product.trade;
  for (const tier of product.tiers) {
    if (quantity >= tier.from) price = product.trade * (1 - tier.discount);
  }
  // Trade prices are quoted to the cent; a fraction of one is not a price.
  return Math.round(price * 100) / 100;
}

/** The break the buyer is currently on, and the next one up, for nudging. */
export function tierState(product: Product, quantity: number) {
  const reached = product.tiers.filter((t) => quantity >= t.from).pop();
  const next = product.tiers.find((t) => quantity < t.from);
  return { reached, next };
}

/** Gross margin on RRP, at a given quantity. */
export function marginAt(product: Product, quantity = product.moq): number {
  const cost = unitPriceAt(product, quantity);
  return (product.rrp - cost) / product.rrp;
}

/** How many times the trade price the shelf price is. */
export function markup(product: Product): number {
  return product.rrp / product.trade;
}

export function stockLevel(product: Product): "in" | "low" | "out" {
  if (product.stock <= 0) return "out";
  if (product.stock < product.caseQty * 10) return "low";
  return "in";
}

export function findProduct(sku: string): Product | undefined {
  return PRODUCTS.find((p) => p.sku === sku);
}

export function categoryOf(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

/** Headline numbers the intro quotes, computed rather than asserted. */
export const CATALOGUE_FACTS = {
  lines: PRODUCTS.length,
  categories: CATEGORIES.length,
  unitsInStock: PRODUCTS.reduce((sum, p) => sum + p.stock, 0),
  averageMargin:
    PRODUCTS.reduce((sum, p) => sum + marginAt(p), 0) / PRODUCTS.length,
  averageMarkup: PRODUCTS.reduce((sum, p) => sum + markup(p), 0) / PRODUCTS.length,
  lowestEntry: Math.min(...PRODUCTS.map((p) => p.trade * p.moq)),
} as const;
