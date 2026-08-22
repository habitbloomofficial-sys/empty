import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting } from "./settings";

// Making a real file rather than talking about one.
//
// "Write me an essay" should end with a document you can open, print and hand
// in — not three screens of chat you then have to copy somewhere. So JARVIS
// writes the content and this renders it: Word for prose, PowerPoint for
// slides, Excel for tables, Markdown for notes.
//
// Everything lands in Documents/JARVIS, which is already inside the folders he
// can search, so "open the essay you wrote" works straight afterwards with no
// extra plumbing.

export type DocumentKind = "essay" | "slides" | "spreadsheet" | "notes";

export interface Section {
  heading?: string;
  /** Prose. One string per paragraph. */
  paragraphs?: string[];
  /** Bullet points, for slides or a list inside a document. */
  bullets?: string[];
}

export interface Sheet {
  name?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface DocumentRequest {
  kind: DocumentKind;
  title: string;
  subtitle?: string;
  sections?: Section[];
  sheets?: Sheet[];
  /** Overrides the name. Treated as a name only, never a path. */
  filename?: string;
}

export interface WrittenDocument {
  path: string;
  filename: string;
  kind: DocumentKind;
  folder: string;
  /** Words, slides or rows, depending on what was made. */
  size: string;
}

/** Where documents go. Inside Documents so the file tools already reach it. */
export function outputFolder(): string {
  const configured = getSetting("DOCUMENTS_FOLDER")?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), "Documents", "JARVIS");
}

/**
 * A filename that is safe on Windows.
 *
 * Windows refuses several punctuation characters outright, silently drops
 * trailing dots and spaces, and reserves a list of device names — a file
 * called "CON.docx" cannot be created at all.
 */
export function safeFilename(title: string, extension: string): string {
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

  let base = (title || "Untitled")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");

  if (!base) base = "Untitled";
  if (reserved.test(base)) base = `${base} document`;
  // Long paths still bite on Windows, and a title is only a name.
  if (base.length > 80) base = base.slice(0, 80).trim();

  return `${base}.${extension}`;
}

/** Never overwrite something already there. */
function uniquePath(folder: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);

  let candidate = path.join(folder, filename);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${stem} (${n})${extension}`);
    n++;
  }
  return candidate;
}

function countWords(sections: Section[]): number {
  return sections
    .flatMap((section) => [...(section.paragraphs ?? []), ...(section.bullets ?? [])])
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

async function writeEssay(request: DocumentRequest, target: string): Promise<string> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  const sections = request.sections ?? [];

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: request.title, heading: HeadingLevel.TITLE }),
  ];
  if (request.subtitle) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: request.subtitle, italics: true })] })
    );
  }

  for (const section of sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const paragraph of section.paragraphs ?? []) {
      children.push(new Paragraph({ text: paragraph, spacing: { after: 160 } }));
    }
    for (const bullet of section.bullets ?? []) {
      children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(target, await Packer.toBuffer(doc));
  return `${countWords(sections)} words`;
}

async function writeSlides(request: DocumentRequest, target: string): Promise<string> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_16x9";

  const title = deck.addSlide();
  title.addText(request.title, { x: 0.6, y: 2.1, w: 8.8, h: 1, fontSize: 40, bold: true });
  if (request.subtitle) {
    title.addText(request.subtitle, {
      x: 0.6,
      y: 3.1,
      w: 8.8,
      h: 0.6,
      fontSize: 20,
      color: "666666",
    });
  }

  const sections = request.sections ?? [];
  for (const section of sections) {
    const slide = deck.addSlide();
    slide.addText(section.heading ?? "", {
      x: 0.6,
      y: 0.5,
      w: 8.8,
      h: 0.9,
      fontSize: 28,
      bold: true,
    });

    const points = [...(section.bullets ?? []), ...(section.paragraphs ?? [])];
    if (points.length > 0) {
      slide.addText(
        points.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.6, w: 8.4, h: 3.6, fontSize: 18, valign: "top" }
      );
    }
  }

  // pptxgenjs types its Node output loosely; it is a Buffer here.
  const data = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
  fs.writeFileSync(target, data);
  return `${sections.length + 1} slides`;
}

async function writeSpreadsheet(request: DocumentRequest, target: string): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheets = request.sheets ?? [];
  if (sheets.length === 0) {
    throw new Error("A spreadsheet needs at least one sheet of data, sir.");
  }

  let rowCount = 0;
  sheets.forEach((sheet, index) => {
    // Sheet names have their own rules, and a duplicate name throws.
    const cleaned = (sheet.name || `Sheet${index + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
    const worksheet = workbook.addWorksheet(cleaned.trim() || `Sheet${index + 1}`);

    const columns = sheet.columns ?? [];
    if (columns.length > 0) {
      worksheet.addRow(columns);
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
    }
    for (const row of sheet.rows ?? []) {
      worksheet.addRow(row);
      rowCount++;
    }

    // Width from the longest cell, so numbers never open as a row of hashes.
    worksheet.columns.forEach((column, i) => {
      const longest = Math.max(
        (columns[i] ?? "").length,
        ...(sheet.rows ?? []).map((row) => String(row[i] ?? "").length)
      );
      column.width = Math.min(Math.max(longest + 2, 10), 60);
    });
  });

  await workbook.xlsx.writeFile(target);
  return `${rowCount} rows across ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`;
}

function writeNotes(request: DocumentRequest, target: string): string {
  const lines = [`# ${request.title}`, ""];
  if (request.subtitle) lines.push(`*${request.subtitle}*`, "");

  for (const section of request.sections ?? []) {
    if (section.heading) lines.push(`## ${section.heading}`, "");
    for (const paragraph of section.paragraphs ?? []) lines.push(paragraph, "");
    for (const bullet of section.bullets ?? []) lines.push(`- ${bullet}`);
    if (section.bullets?.length) lines.push("");
  }

  const text = lines.join("\n");
  fs.writeFileSync(target, text, "utf-8");
  return `${text.split(/\s+/).filter(Boolean).length} words`;
}

const EXTENSIONS: Record<DocumentKind, string> = {
  essay: "docx",
  slides: "pptx",
  spreadsheet: "xlsx",
  notes: "md",
};

export async function createDocument(request: DocumentRequest): Promise<WrittenDocument> {
  const title = request.title?.trim();
  if (!title) throw new Error("The document needs a title, sir.");

  const extension = EXTENSIONS[request.kind];
  if (!extension) throw new Error(`I don't know how to write a "${request.kind}", sir.`);

  const folder = outputFolder();
  fs.mkdirSync(folder, { recursive: true });

  // A filename from the model is a name, never a path — basename strips any
  // attempt to climb out of the folder or point elsewhere on the disk.
  const requested = request.filename?.trim()
    ? safeFilename(path.basename(request.filename.trim()).replace(/\.[^.]+$/, ""), extension)
    : safeFilename(title, extension);
  const target = uniquePath(folder, requested);

  let size: string;
  if (request.kind === "essay") size = await writeEssay(request, target);
  else if (request.kind === "slides") size = await writeSlides(request, target);
  else if (request.kind === "spreadsheet") size = await writeSpreadsheet(request, target);
  else size = writeNotes(request, target);

  return {
    path: target,
    filename: path.basename(target),
    kind: request.kind,
    folder,
    size,
  };
}
