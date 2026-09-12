// A PDF, written by hand.
//
// No library. Not out of pride — because every dependency added to this project
// has to survive an `npm install` on his machine, and the last one that didn't
// cost a fortnight of "Failed to type check" with the fix sitting unreachable
// on GitHub. A PDF that needs nothing installed works the moment he pulls, even
// if npm is broken, which is the state he is most likely to be in when he wants
// one.
//
// It is less magic than it sounds. A PDF is a text file listing objects, a
// table of their byte offsets, and a trailer pointing at the table. Text is
// drawn with the fourteen fonts every reader already has, so nothing has to be
// embedded. The only real work is knowing how wide a line is before you draw
// it, which is what the width tables below are for.

const PAGE_WIDTH = 595.28; // A4, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Character widths for Helvetica and Helvetica-Bold, in thousandths of the font
 * size, for the printable ASCII range. Straight from the Adobe metrics.
 *
 * Without these there is no way to know where a line ends, and text either runs
 * off the page or wraps at a guess. Anything outside the range falls back to
 * the width of "o", which is within a few percent for the accented letters
 * Danish actually uses.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export type Face = "regular" | "bold";

function widthOf(text: string, face: Face, size: number): number {
  const table = face === "bold" ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 32 && code <= 126) units += table[code - 32];
    // The punctuation above: a dash is wide, a quote is narrow, and wrapping
    // a line of dialogue as though every one were an "o" reads badly.
    else if (char === "\u2014") units += 1000;
    else if (char === "\u2013" || char === "\u2026") units += 1000;
    else if (char === "\u2018" || char === "\u2019") units += 222;
    else if (char === "\u201c" || char === "\u201d") units += 333;
    else if (char === "\u2022") units += 350;
    else units += 556;
  }
  return (units * size) / 1000;
}

/**
 * Break a paragraph into lines that fit.
 *
 * A word longer than the whole line — a URL, usually — is placed on its own
 * line and allowed to overrun rather than being split at an arbitrary letter.
 * A broken URL is worse than an ugly one.
 */
export function wrap(text: string, face: Face, size: number, width = TEXT_WIDTH): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, face, size) <= width || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The characters a butler actually types, in the byte the font expects.
 *
 * The file is written as one byte per character, and an em dash is not a
 * latin1 character — so without this it becomes a hole in the sentence, which
 * is exactly where a dash always is. WinAnsiEncoding does have all of these;
 * they simply live above 0x7F at numbers latin1 uses for something else.
 */
const WIN_ANSI: Record<string, number> = {
  "\u2013": 0x96, // – en dash
  "\u2014": 0x97, // — em dash
  "\u2018": 0x91, // ' left single quote
  "\u2019": 0x92, // ' right single quote / apostrophe
  "\u201c": 0x93, // " left double quote
  "\u201d": 0x94, // " right double quote
  "\u2022": 0x95, // • bullet
  "\u2026": 0x85, // … ellipsis
  "\u20ac": 0x80, // € euro
  "\u2039": 0x8b,
  "\u203a": 0x9b,
  "\u2122": 0x99, // ™
};

/** Turn one character into the byte WinAnsi wants, or nothing if it has none. */
function winAnsiByte(char: string): number | null {
  const mapped = WIN_ANSI[char];
  if (mapped !== undefined) return mapped;
  const code = char.codePointAt(0) ?? 0;
  // latin1 and WinAnsi agree everywhere except 0x80-0x9F, handled above. That
  // covers every letter Danish needs.
  if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) return code;
  return null;
}

/**
 * Escape the three characters that mean something inside a PDF string, and put
 * everything else into the encoding the font is declared with.
 *
 * Anything with no WinAnsi byte at all becomes "?" rather than disappearing: a
 * visible wrong character can be reported, a silently missing one cannot.
 */
function escapePdf(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\\") { out += "\\\\"; continue; }
    if (char === "(") { out += "\\("; continue; }
    if (char === ")") { out += "\\)"; continue; }
    const byte = winAnsiByte(char);
    if (byte === null) { out += "?"; continue; }
    // Octal escapes for everything above ASCII, so the file stays plain text.
    out += byte < 0x80 ? char : `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return out;
}

// --- the document, as something to describe rather than draw ---------------

export interface PdfStep {
  /** "Day 1", "Step 3" — whatever numbers the thing. */
  marker?: string;
  title: string;
  detail?: string;
}

export interface PdfSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: PdfStep[];
}

export interface PdfDocument {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  /** Printed small at the foot of every page, beside the page number. */
  footer?: string;
}

interface Drawn {
  text: string;
  x: number;
  y: number;
  size: number;
  face: Face;
  grey?: number;
}

/**
 * Lay the whole document out into positioned pieces of text.
 *
 * Separated from the PDF encoding below because this is the part with
 * judgement in it — where a page breaks, whether a heading is left stranded at
 * the foot of one — and judgement is the part worth testing. Encoding bytes is
 * not.
 */
export function layout(doc: PdfDocument): Drawn[][] {
  const pages: Drawn[][] = [];
  let page: Drawn[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    pages.push(page);
    page = [];
    y = PAGE_HEIGHT - MARGIN;
  };

  /** Room for `needed` points, or start a fresh page. */
  const room = (needed: number) => {
    if (y - needed < MARGIN + 28) newPage();
  };

  const write = (text: string, face: Face, size: number, indent = 0, grey?: number) => {
    for (const line of wrap(text, face, size, TEXT_WIDTH - indent)) {
      room(size * 1.35);
      page.push({ text: line, x: MARGIN + indent, y, size, face, grey });
      y -= size * 1.35;
    }
  };

  // --- title block ---------------------------------------------------------
  for (const line of wrap(doc.title, "bold", 22)) {
    page.push({ text: line, x: MARGIN, y, size: 22, face: "bold" });
    y -= 27;
  }
  if (doc.subtitle) {
    y -= 2;
    for (const line of wrap(doc.subtitle, "regular", 11)) {
      page.push({ text: line, x: MARGIN, y, size: 11, face: "regular", grey: 0.35 });
      y -= 15;
    }
  }
  y -= 16;

  // --- sections ------------------------------------------------------------
  for (const section of doc.sections) {
    if (section.heading) {
      // A heading with no room for anything under it belongs on the next page.
      room(52);
      y -= 6;
      write(section.heading, "bold", 14);
      y -= 4;
    }

    for (const paragraph of section.paragraphs ?? []) {
      write(paragraph, "regular", 11);
      y -= 7;
    }

    for (const bullet of section.bullets ?? []) {
      room(16);
      page.push({ text: "•", x: MARGIN, y, size: 11, face: "regular" });
      write(bullet, "regular", 11, 16);
      y -= 3;
    }

    for (const step of section.steps ?? []) {
      // Keep a step's marker, title and first line together.
      room(40);
      if (step.marker) {
        page.push({ text: step.marker, x: MARGIN, y, size: 10, face: "bold", grey: 0.4 });
        y -= 14;
      }
      write(step.title, "bold", 11.5);
      if (step.detail) {
        y -= 1;
        write(step.detail, "regular", 10.5, 0, 0.2);
      }
      y -= 9;
    }

    y -= 8;
  }

  pages.push(page);
  return pages.filter((entries) => entries.length > 0);
}

// --- encoding ---------------------------------------------------------------

function contentStream(entries: Drawn[], footer: string, pageNumber: number, total: number): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const font = entry.face === "bold" ? "/F2" : "/F1";
    const grey = entry.grey ?? 0;
    parts.push(
      `BT ${font} ${entry.size} Tf ${grey} ${grey} ${grey} rg ` +
        `1 0 0 1 ${entry.x.toFixed(2)} ${entry.y.toFixed(2)} Tm ` +
        `(${escapePdf(entry.text)}) Tj ET`
    );
  }

  const foot = footer ? `${footer}   ` : "";
  const label = `${foot}${pageNumber} of ${total}`;
  parts.push(
    `BT /F1 8.5 Tf 0.45 0.45 0.45 rg ` +
      `1 0 0 1 ${MARGIN} ${(MARGIN - 18).toFixed(2)} Tm (${escapePdf(label)}) Tj ET`
  );
  return parts.join("\n");
}

/** The finished file. */
export function renderPdf(doc: PdfDocument): Buffer {
  const pages = layout(doc);
  const total = pages.length;

  // Object 1 catalog, 2 page tree, 3 and 4 the fonts, then a page and a stream
  // for each sheet.
  const objects: string[] = [];
  const pageIds: number[] = [];
  const FIRST_PAGE_ID = 5;

  for (let i = 0; i < total; i++) pageIds.push(FIRST_PAGE_ID + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Count ${total} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  pages.forEach((entries, index) => {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const stream = contentStream(entries, doc.footer ?? "", index + 1, total);

    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
      `/Contents ${streamId} 0 R >>`;
    objects[streamId] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  // latin1 throughout: WinAnsiEncoding is a superset of it for the characters
  // that matter, and one byte per character keeps /Length honest.
  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(file, "latin1");
    file += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefAt = Buffer.byteLength(file, "latin1");
  const count = objects.length;
  file += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    file += offsets[id]
      ? `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
      : `0000000000 65535 f \n`;
  }
  file += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(file, "latin1");
}
