import { MONEY } from "./brand";

/*
 * Hand-rolled rather than Intl, deliberately.
 *
 * These numbers are rendered on the server and then again in the browser, and
 * the two do not always agree on which invisible space Intl puts before a
 * currency symbol — which shows up as a hydration mismatch on a page whose
 * whole job is to look composed. A formatter this small has one answer.
 */

/** `1234.5` -> `1,234.50` */
export function group(value: number, decimals = 2): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = value < 0 ? "-" : "";
  return fraction ? `${sign}${spaced}.${fraction}` : `${sign}${spaced}`;
}

/** `1234.5` -> `€1,234.50` */
export function money(value: number, decimals = 2): string {
  return `${MONEY.symbol}${group(value, decimals)}`;
}

/** Whole euros, for headline figures where cents are noise. */
export function moneyRound(value: number): string {
  return `${MONEY.symbol}${group(value, 0)}`;
}

/** `0.583` -> `58%` */
export function percent(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** `2.42` -> `2.4x` — how many times trade price the shelf price is. */
export function multiple(value: number): string {
  return `${value.toFixed(1)}x`;
}

/** `1250` -> `1,250 units` (or `1 unit`). */
export function units(count: number): string {
  return `${group(count, 0)} ${count === 1 ? "unit" : "units"}`;
}
