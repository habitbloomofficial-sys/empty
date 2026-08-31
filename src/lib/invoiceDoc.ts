import fs from "node:fs";
import path from "node:path";
import { outputFolder, safeFilename, uniquePath } from "./documents";
import { pickTheme } from "./docTheme";
import { getSetting } from "./settings";
import { formatMoney, statusOf, totalsOf, type Bill } from "./bills";

// The invoice as a document.
//
// Kept apart from bills.ts on purpose. That file is the arithmetic and the
// record, and it has no idea what Word is; this one turns a bill into something
// that can be sent to a person, and it does no sums of its own — it asks for
// the totals and prints them. If the two ever disagreed the numbers he was told
// and the numbers on the paper would differ, which is the one failure an
// invoice cannot have.
//
// It looks like an invoice rather than a memo with numbers in it: the amount
// due large and on its own, the line items in a banded table, and the payment
// details where anyone paying it will look.

/**
 * Who it is from.
 *
 * One block of free text in Settings — name, address, VAT number, whatever the
 * country wants. Trying to model an address across jurisdictions is a losing
 * game, and a text box he fills in once is both simpler and more correct.
 */
export function addressLines(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  // Newlines or pipes, because a settings box gets one and a spoken sentence
  // gets the other.
  return raw
    .split(/\r?\n|\s*\|\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function senderBlock(): string[] {
  return addressLines(getSetting("INVOICE_FROM"));
}

export function paymentBlock(): string[] {
  return addressLines(getSetting("INVOICE_PAYMENT_DETAILS"));
}

export interface WrittenInvoice {
  path: string;
  filename: string;
  folder: string;
}

/**
 * Write it.
 *
 * An incoming bill gets a document too — it is how he keeps a record of one
 * that arrived by post or as a photograph, and the wording changes so the two
 * are never confused for one another.
 */
export async function writeInvoice(bill: Bill): Promise<WrittenInvoice> {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType,
    Table, TableRow, TableCell, WidthType,
  } = await import("docx");

  const theme = pickTheme(undefined, bill.number);
  const totals = totalsOf(bill.lines, bill.taxPercent);
  const outgoing = bill.direction === "outgoing";
  const status = statusOf(bill);
  const money = (minor: number) => formatMoney(minor, bill.currency);

  const children: InstanceType<typeof Paragraph>[] = [];

  const heading = (text: string) =>
    new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [
        new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: theme.accent }),
      ],
    });
  const body = (text: string, options: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text, size: options.size ?? 21, bold: options.bold, color: theme.ink }),
      ],
    });

  // Title, and the word that says which kind of thing this is.
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: outgoing ? "INVOICE" : "BILL RECEIVED",
          bold: true,
          size: 44,
          color: theme.accent,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: theme.accent, space: 6 } },
      children: [
        new TextRun({ text: `No. ${bill.number}`, size: 22, color: theme.ink }),
        new TextRun({ text: `    Issued ${bill.issued}`, size: 22, color: theme.accent2 }),
        new TextRun({ text: `    Due ${bill.due}`, size: 22, color: theme.accent2 }),
      ],
    })
  );

  const from = senderBlock();
  if (from.length > 0) {
    children.push(heading(outgoing ? "From" : "Received by"));
    for (const line of from) children.push(body(line));
  }

  children.push(heading(outgoing ? "To" : "From"));
  // An address arrives as one string with newlines in it; a run does not break
  // on them, so it is split here or the whole address comes out on one line.
  const to = addressLines(bill.party);
  children.push(body(to[0] ?? bill.party, { bold: true, size: 23 }));
  for (const line of to.slice(1)) children.push(body(line));
  if (bill.reference) children.push(body(`Your reference: ${bill.reference}`));

  // The line items.
  const cell = (text: string, options: { bold?: boolean; right?: boolean; fill?: string; onFill?: boolean } = {}) =>
    new TableCell({
      shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill } : undefined,
      children: [
        new Paragraph({
          alignment: options.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun({
              text,
              bold: options.bold,
              size: 21,
              color: options.onFill ? theme.onAccent : theme.ink,
            }),
          ],
        }),
      ],
    });

  const header = new TableRow({
    children: [
      cell("Description", { bold: true, fill: theme.accent, onFill: true }),
      cell("Qty", { bold: true, right: true, fill: theme.accent, onFill: true }),
      cell("Unit", { bold: true, right: true, fill: theme.accent, onFill: true }),
      cell("Amount", { bold: true, right: true, fill: theme.accent, onFill: true }),
    ],
  });

  const rows = bill.lines.map((line, i) => {
    const lineMinor = Math.round(line.unitMinor * line.quantity);
    const fill = i % 2 === 0 ? theme.wash : undefined;
    return new TableRow({
      children: [
        cell(line.description, { fill }),
        cell(String(line.quantity), { right: true, fill }),
        cell(money(line.unitMinor), { right: true, fill }),
        cell(money(lineMinor), { right: true, fill }),
      ],
    });
  });

  children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
  children.push(
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }) as never
  );

  // Totals, as their own small table pushed to the right of the page.
  const totalRow = (label: string, value: string, emphasis = false) =>
    new TableRow({
      children: [
        cell(label, { bold: emphasis, right: true, fill: emphasis ? theme.accent : undefined, onFill: emphasis }),
        cell(value, { bold: emphasis, right: true, fill: emphasis ? theme.accent : undefined, onFill: emphasis }),
      ],
    });

  const totalRows = [totalRow("Subtotal", money(totals.subtotalMinor))];
  for (const rate of totals.byRate) {
    // A bill with one rate on it says "VAT 25%"; one with two says which base
    // each rate applied to, because otherwise the sum cannot be checked.
    const label =
      totals.byRate.length === 1
        ? `VAT ${rate.percent}%`
        : `VAT ${rate.percent}% on ${money(rate.baseMinor)}`;
    totalRows.push(totalRow(label, money(rate.taxMinor)));
  }
  totalRows.push(totalRow(outgoing ? "Total due" : "Total", money(totals.totalMinor), true));

  children.push(new Paragraph({ spacing: { before: 160 }, children: [] }));
  children.push(
    new Table({
      width: { size: 55, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.RIGHT,
      rows: totalRows,
    }) as never
  );

  if (bill.paidOn) {
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [
          new TextRun({ text: `PAID ${bill.paidOn}`, bold: true, size: 26, color: theme.accent }),
        ],
      })
    );
  } else if (status === "overdue") {
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [
          new TextRun({ text: `OVERDUE — was due ${bill.due}`, bold: true, size: 24, color: "B91C1C" }),
        ],
      })
    );
  }

  const payment = paymentBlock();
  if (outgoing && payment.length > 0) {
    children.push(heading("Payment"));
    for (const line of payment) children.push(body(line));
  }

  if (bill.notes) {
    children.push(heading("Notes"));
    children.push(body(bill.notes));
  }

  const folder = path.join(outputFolder(), "Bills");
  fs.mkdirSync(folder, { recursive: true });
  const target = uniquePath(
    folder,
    safeFilename(`${outgoing ? "Invoice" : "Bill"} ${bill.number} ${bill.party}`.slice(0, 60), "docx")
  );

  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(target, await Packer.toBuffer(doc));

  return { path: target, filename: path.basename(target), folder };
}
