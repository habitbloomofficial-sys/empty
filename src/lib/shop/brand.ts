/*
 * One place to rebrand the whole portal.
 *
 * This is a trade shop built for a client whose products aren't decided yet, so
 * everything the client will want to change — the name on the door, the money,
 * the thresholds printed on the checkout — is a value here rather than a string
 * scattered through thirty components.
 */

export const BRAND = {
  /** Wordmark. Short, so it sits well in the header at any width. */
  name: "AUREA",
  /** Said in full on the gate and in the footer. */
  full: "Aurea Wholesale",
  /** What the portal is, in five words. */
  kicker: "Trade Portal",
  tagline: "Stock that sells itself.",
  since: 2014,
  contact: {
    email: "trade@aurea-wholesale.com",
    phone: "+45 70 60 50 40",
    address: "Havnegade 18, 2100 Copenhagen, Denmark",
  },
} as const;

/** Money. One currency, stated once. */
export const MONEY = {
  symbol: "€",
  code: "EUR",
} as const;

/** The commercial rules the shop quotes and enforces. */
export const TERMS = {
  /** Order value above which carriage is on us. */
  freeShippingFrom: 1500,
  /** Flat carriage below that. */
  shippingFlat: 45,
  /** Nothing under this leaves the warehouse. */
  minimumOrder: 250,
  /** Payment terms offered to an approved account. */
  netDays: 30,
  /** Cut-off for same-day dispatch, in the warehouse's local time. */
  dispatchCutoff: "14:00 CET",
} as const;
