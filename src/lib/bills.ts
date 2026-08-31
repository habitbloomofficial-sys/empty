import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { getSetting } from "./settings";

// Bills: the ones he sends, and the ones he has to pay.
//
// Two rules run through all of it.
//
// Money is never a floating point number. It is an integer count of the
// smallest unit — øre, cents, pence — from the moment it arrives to the moment
// it is printed. 0.1 + 0.2 is not 0.3 in any language with doubles in it, and
// an invoice that is one øre out is an invoice that gets queried. Every amount
// below is an integer, every total is integer arithmetic, and the only
// rounding happens once, deliberately, where the tax is worked out.
//
// And a bill is a record before it is a document. He can ask what is
// outstanding, what is overdue and what he has been paid, because the numbers
// are kept rather than only rendered into a .docx and forgotten.

const STORE = path.join(process.cwd(), "data", "bills.json");

/** Which way the money goes. */
export type Direction =
  /** He is invoicing someone. They owe him. */
  | "outgoing"
  /** A bill that has come in. He owes them. */
  | "incoming";

export type Status = "draft" | "open" | "paid" | "overdue";

export interface LineItem {
  description: string;
  quantity: number;
  /** Price for one, in minor units. 12,50 kr is 1250. */
  unitMinor: number;
  /** Overrides the bill's rate for this line. Zero is a real answer, so it is optional rather than falsy. */
  taxPercent?: number;
}

export interface Bill {
  id: string;
  /** "2026-014". Sequential within the year, and never reused. */
  number: string;
  direction: Direction;
  /** Who it is to, or who it is from. */
  party: string;
  /** ISO date, the day it was issued. */
  issued: string;
  /** ISO date it falls due. */
  due: string;
  currency: string;
  taxPercent: number;
  lines: LineItem[];
  reference?: string;
  notes?: string;
  /** ISO date it was settled, if it has been. */
  paidOn?: string;
  /** Where the document was written, if one was. */
  documentPath?: string;
  createdAt: number;
}

interface Store {
  bills: Bill[];
  /** Highest number handed out per year, so numbering never repeats. */
  counters: Record<string, number>;
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf-8")) as Store;
    return {
      bills: Array.isArray(parsed.bills) ? parsed.bills : [],
      counters: parsed.counters && typeof parsed.counters === "object" ? parsed.counters : {},
    };
  } catch {
    // No file yet, or one that has been damaged. Either way, start clean
    // rather than refusing to work.
    return { bills: [], counters: {} };
  }
}

function write(store: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  writeFileAtomic(STORE, JSON.stringify(store, null, 2));
}

// --- money ------------------------------------------------------------------

/** Half away from zero, which is what everyone means by "round" on an invoice. */
function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Turn what he said into minor units.
 *
 * He will say "twelve fifty" as 12.5, and a form will send "12,50". Both mean
 * 1250 øre. Parsing this in one place means the rest of the file never sees a
 * decimal, which is the point.
 */
export function toMinor(amount: number | string): number {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new Error("That isn't an amount, sir.");
    return roundMinor(amount * 100);
  }
  const cleaned = amount.trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!cleaned) throw new Error("That isn't an amount, sir.");

  // "1.234,56" is Danish for "1,234.56". Whichever separator comes last is the
  // decimal one; anything before it is a thousands separator and goes.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised = cleaned;
  if (lastComma >= 0 && lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    normalised = cleaned.replace(/,/g, "");
  } else {
    normalised = cleaned.replace(/,/g, "");
  }

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) throw new Error(`I can't read "${amount}" as an amount, sir.`);
  return roundMinor(parsed * 100);
}

export function currencyOf(): string {
  return (getSetting("CURRENCY") ?? "DKK").trim().toUpperCase() || "DKK";
}

export function localeOf(): string {
  return getSetting("INVOICE_LOCALE")?.trim() || "da-DK";
}

/** For reading out and for printing. Falls back rather than throwing on a bad code. */
export function formatMoney(minor: number, currency = currencyOf(), locale = localeOf()): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export interface Totals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Split out per rate, because a bill with two rates on it has to show both. */
  byRate: { percent: number; baseMinor: number; taxMinor: number }[];
}

/**
 * Add it up.
 *
 * Tax is worked out per rate on the summed base for that rate, not per line.
 * That matters: rounding each line separately and adding the results can land
 * a couple of øre away from the tax on the total, and that difference is
 * exactly what an accountant queries. One rounding, per rate, at the end.
 */
export function totalsOf(lines: LineItem[], taxPercent: number): Totals {
  const buckets = new Map<number, number>();
  let subtotalMinor = 0;

  for (const line of lines) {
    const lineMinor = roundMinor(line.unitMinor * line.quantity);
    subtotalMinor += lineMinor;
    const rate = line.taxPercent ?? taxPercent;
    buckets.set(rate, (buckets.get(rate) ?? 0) + lineMinor);
  }

  const byRate = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([percent, baseMinor]) => ({
      percent,
      baseMinor,
      taxMinor: roundMinor((baseMinor * percent) / 100),
    }));

  const taxMinor = byRate.reduce((sum, row) => sum + row.taxMinor, 0);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, byRate };
}

// --- dates ------------------------------------------------------------------

/** ISO day, in local time — a bill belongs to the day he issued it, not to UTC. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

export function statusOf(bill: Bill, today = isoDay(new Date())): Status {
  if (bill.paidOn) return "paid";
  return bill.due < today ? "overdue" : "open";
}

export function daysLate(bill: Bill, today = isoDay(new Date())): number {
  if (bill.paidOn || bill.due >= today) return 0;
  const [ay, am, ad] = bill.due.split("-").map(Number);
  const [by, bm, bd] = today.split("-").map(Number);
  const from = Date.UTC(ay, am - 1, ad);
  const to = Date.UTC(by, bm - 1, bd);
  return Math.round((to - from) / 86_400_000);
}

// --- numbering --------------------------------------------------------------

/**
 * The next invoice number, and it is never reused.
 *
 * A counter per year, held in the same file as the bills and bumped even if the
 * document fails to write. Reusing a number is worse than skipping one: two
 * invoices with the same number is a bookkeeping problem, a gap is not.
 */
export function nextNumber(store: Store, issued: string): string {
  const year = issued.slice(0, 4);
  const next = (store.counters[year] ?? 0) + 1;
  store.counters[year] = next;
  return `${year}-${String(next).padStart(3, "0")}`;
}

// --- the operations ---------------------------------------------------------

export interface BillRequest {
  direction?: Direction;
  party: string;
  lines: { description: string; quantity?: number; amount: number | string; taxPercent?: number }[];
  taxPercent?: number;
  currency?: string;
  issued?: string;
  /** Days from issue. Danish invoices are usually 8, 14 or 30. */
  termsDays?: number;
  due?: string;
  reference?: string;
  notes?: string;
  /** Already settled — recording something after the fact. */
  paidOn?: string;
}

/** Danish VAT, and the commonest Danish payment terms, unless he says otherwise. */
export const DEFAULT_TAX_PERCENT = 25;
export const DEFAULT_TERMS_DAYS = 14;

function settingNumber(key: "INVOICE_TAX_PERCENT" | "INVOICE_TERMS_DAYS", fallback: number): number {
  const raw = getSetting(key)?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function defaultTaxPercent(): number {
  return settingNumber("INVOICE_TAX_PERCENT", DEFAULT_TAX_PERCENT);
}

export function defaultTermsDays(): number {
  return settingNumber("INVOICE_TERMS_DAYS", DEFAULT_TERMS_DAYS);
}

export function createBill(request: BillRequest, now = new Date()): Bill {
  if (!request.party?.trim()) {
    throw new Error("Who is it to, sir? A bill needs a name on it.");
  }
  if (!request.lines?.length) {
    throw new Error("There's nothing on that bill, sir — what is it for?");
  }

  const taxPercent = request.taxPercent ?? defaultTaxPercent();
  if (taxPercent < 0 || taxPercent > 100) {
    throw new Error(`A tax rate of ${taxPercent}% isn't right, sir.`);
  }

  const lines: LineItem[] = request.lines.map((line, i) => {
    if (!line.description?.trim()) throw new Error(`Line ${i + 1} needs a description, sir.`);
    const quantity = line.quantity ?? 1;
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new Error(`Line ${i + 1}: a quantity of ${line.quantity} doesn't work, sir.`);
    }
    return {
      description: line.description.trim(),
      quantity,
      unitMinor: toMinor(line.amount),
      taxPercent: line.taxPercent,
    };
  });

  const issued = request.issued ?? isoDay(now);
  const due = request.due ?? addDays(issued, request.termsDays ?? defaultTermsDays());
  if (due < issued) {
    throw new Error("That bill falls due before it was issued, sir — one of those dates is wrong.");
  }

  const store = read();
  const bill: Bill = {
    id: `bill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    number: nextNumber(store, issued),
    direction: request.direction ?? "outgoing",
    party: request.party.trim(),
    issued,
    due,
    currency: (request.currency ?? currencyOf()).toUpperCase(),
    taxPercent,
    lines,
    reference: request.reference?.trim() || undefined,
    notes: request.notes?.trim() || undefined,
    paidOn: request.paidOn,
    createdAt: Date.now(),
  };

  store.bills.push(bill);
  write(store);
  return bill;
}

export function allBills(): Bill[] {
  return read().bills;
}

export interface BillFilter {
  direction?: Direction;
  status?: Status | "all";
  party?: string;
}

export function listBills(filter: BillFilter = {}, today = isoDay(new Date())): Bill[] {
  const wanted = filter.status ?? "all";
  const party = filter.party?.trim().toLowerCase();

  return read()
    .bills.filter((bill) => {
      if (filter.direction && bill.direction !== filter.direction) return false;
      if (party && !bill.party.toLowerCase().includes(party)) return false;
      if (wanted !== "all" && statusOf(bill, today) !== wanted) return false;
      return true;
    })
    // Soonest due first, which is the order anyone wants to see money in.
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** Find one by number, or by id, or by the party's name if that is unambiguous. */
export function findBill(reference: string): Bill | null {
  const key = reference.trim().toLowerCase();
  const bills = read().bills;
  const byNumber = bills.find((b) => b.number.toLowerCase() === key || b.id.toLowerCase() === key);
  if (byNumber) return byNumber;

  // A partial number: "14" should find 2026-014 when only one matches.
  const loose = bills.filter(
    (b) => b.number.toLowerCase().includes(key) || b.party.toLowerCase().includes(key)
  );
  return loose.length === 1 ? loose[0] : null;
}

export function markPaid(reference: string, on = isoDay(new Date())): Bill {
  const store = read();
  const target = findBill(reference);
  if (!target) {
    throw new Error(`I can't find a bill matching "${reference}", sir — give me the number.`);
  }
  const bill = store.bills.find((b) => b.id === target.id);
  if (!bill) throw new Error("That bill has gone missing, sir.");
  if (bill.paidOn) {
    throw new Error(`${bill.number} was already settled on ${bill.paidOn}, sir.`);
  }
  bill.paidOn = on;
  write(store);
  return bill;
}

export function markUnpaid(reference: string): Bill {
  const store = read();
  const target = findBill(reference);
  if (!target) throw new Error(`I can't find a bill matching "${reference}", sir.`);
  const bill = store.bills.find((b) => b.id === target.id)!;
  delete bill.paidOn;
  write(store);
  return bill;
}

export function forgetBill(reference: string): Bill {
  const store = read();
  const target = findBill(reference);
  if (!target) throw new Error(`I can't find a bill matching "${reference}", sir.`);
  store.bills = store.bills.filter((b) => b.id !== target.id);
  // The counter is deliberately left alone: a deleted invoice's number is not
  // handed out again, because two documents with one number is worse than a gap.
  write(store);
  return target;
}

export interface Position {
  owedToHimMinor: number;
  owedByHimMinor: number;
  overdueIn: Bill[];
  overdueOut: Bill[];
  dueSoon: Bill[];
  currency: string;
}

/**
 * Where he stands.
 *
 * Only unpaid bills count, and the two directions are kept apart — netting what
 * he is owed against what he owes gives a number that is true and useless.
 * Anything in a currency other than the main one is left out of the totals
 * rather than added up wrong; it still shows in the lists.
 */
export function position(today = isoDay(new Date()), withinDays = 7): Position {
  const currency = currencyOf();
  const open = read().bills.filter((bill) => !bill.paidOn);
  const soon = addDays(today, withinDays);

  let owedToHimMinor = 0;
  let owedByHimMinor = 0;
  const overdueIn: Bill[] = [];
  const overdueOut: Bill[] = [];
  const dueSoon: Bill[] = [];

  for (const bill of open) {
    const { totalMinor } = totalsOf(bill.lines, bill.taxPercent);
    if (bill.currency === currency) {
      if (bill.direction === "outgoing") owedToHimMinor += totalMinor;
      else owedByHimMinor += totalMinor;
    }
    if (bill.due < today) {
      (bill.direction === "outgoing" ? overdueOut : overdueIn).push(bill);
    } else if (bill.due <= soon) {
      dueSoon.push(bill);
    }
  }

  const byDue = (a: Bill, b: Bill) => a.due.localeCompare(b.due);
  return {
    owedToHimMinor,
    owedByHimMinor,
    overdueIn: overdueIn.sort(byDue),
    overdueOut: overdueOut.sort(byDue),
    dueSoon: dueSoon.sort(byDue),
    currency,
  };
}

/** One line describing a bill, for reading out. */
export function describeBill(bill: Bill, today = isoDay(new Date())): string {
  const { totalMinor } = totalsOf(bill.lines, bill.taxPercent);
  const money = formatMoney(totalMinor, bill.currency);
  const status = statusOf(bill, today);
  const late = daysLate(bill, today);

  const who = bill.direction === "outgoing" ? `to ${bill.party}` : `from ${bill.party}`;
  if (status === "paid") return `${bill.number} ${who}, ${money} — settled ${bill.paidOn}.`;
  if (status === "overdue") {
    return `${bill.number} ${who}, ${money} — ${late} day${late === 1 ? "" : "s"} overdue (was due ${bill.due}).`;
  }
  return `${bill.number} ${who}, ${money} — due ${bill.due}.`;
}
