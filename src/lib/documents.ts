import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting } from "./settings";
import { motif, pickTheme, titleMotif, type Mark } from "./docTheme";

// Making a real file rather than talking about one.
//
// "Write me an essay" should end with a document you can open, print and hand
// in — not three screens of chat you then have to copy somewhere. So Axis
// writes the content and this renders it: Word for prose, PowerPoint for
// slides, Excel for tables, Markdown for notes.
//
// Everything lands in Documents/Axis, which is already inside the folders he
// can search, so "open the essay you wrote" works straight afterwards with no
// extra plumbing.

export type DocumentKind = "essay" | "slides" | "spreadsheet" | "notes";

export interface Section {
  heading?: string;
  /** Prose. One string per paragraph. */
  paragraphs?: string[];
  /** Bullet points, for slides or a list inside a document. */
  bullets?: string[];
  /**
   * How this slide is built. "bullets" is the ordinary one; "statement" gives
   * the whole slide over to a single line in large type on colour, which is
   * what you want for the sentence that matters; "columns" splits the points
   * into two; "quote" sets it as a pulled quotation.
   */
  layout?: "bullets" | "statement" | "columns" | "quote";
  /** A few labelled numbers, drawn as bars. Nothing is invented to fill it. */
  figures?: { label: string; value: number }[];
  /** Attribution, for a quote. */
  attribution?: string;
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
  /**
   * A palette by name — midnight, ocean, ember, forest, berry, slate. Left out,
   * one is chosen from the title, so the same document is always the same
   * colour.
   */
  theme?: string;
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
  return path.join(os.homedir(), "Documents", "Axis");
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
export function uniquePath(folder: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);

  let candidate = path.join(folder, filename);
  let n = 2;
  while (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
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
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType,
  } = await import("docx");

  const theme = pickTheme(request.theme, request.title);
  const sections = request.sections ?? [];
  const children: InstanceType<typeof Paragraph>[] = [];

  // A title in colour, over a rule in the accent. Word has no shapes worth the
  // trouble, so the colour does the work that shapes do on a slide.
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: request.title, bold: true, size: 44, color: theme.heading }),
      ],
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: request.subtitle ? 80 : 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 4 } },
      children: [],
    })
  );
  if (request.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 320 },
        children: [
          new TextRun({ text: request.subtitle, italics: true, size: 24, color: theme.accent2 }),
        ],
      })
    );
  }

  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          spacing: { before: 320, after: 40 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 8 } },
          children: [
            new TextRun({ text: section.heading, bold: true, size: 30, color: theme.heading }),
          ],
        })
      );
    }

    // A quote is set apart: tinted, indented, with a coloured edge.
    if (section.layout === "quote" || section.layout === "statement") {
      const line = (section.paragraphs ?? section.bullets ?? [])[0];
      if (line) {
        children.push(
          new Paragraph({
            spacing: { before: 160, after: 160 },
            indent: { left: 360, right: 360 },
            shading: { type: ShadingType.CLEAR, fill: theme.wash },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: theme.accent, space: 12 } },
            children: [
              new TextRun({
                text: section.layout === "quote" ? `"${line}"` : line,
                italics: section.layout === "quote",
                bold: section.layout === "statement",
                size: 26,
                color: theme.heading,
              }),
            ],
          })
        );
        if (section.attribution) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 200 },
              indent: { right: 360 },
              children: [
                new TextRun({ text: `— ${section.attribution}`, size: 20, color: theme.accent2 }),
              ],
            })
          );
        }
        continue;
      }
    }

    for (const paragraph of section.paragraphs ?? []) {
      children.push(
        new Paragraph({
          spacing: { after: 160, line: 300 },
          children: [new TextRun({ text: paragraph, size: 23, color: theme.ink })],
        })
      );
    }
    for (const bullet of section.bullets ?? []) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 90 },
          children: [new TextRun({ text: bullet, size: 23, color: theme.ink })],
        })
      );
    }

    // Numbers become a small table with a coloured header, which is the one
    // piece of furniture Word does better than anything else.
    if (section.figures && section.figures.length > 0) {
      const { Table, TableRow, TableCell, WidthType } = await import("docx");
      const header = new TableRow({
        children: ["", ""].map((_, i) =>
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: theme.accent },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: i === 0 ? "Item" : "Figure",
                    bold: true,
                    size: 20,
                    color: theme.onAccent,
                  }),
                ],
              }),
            ],
          })
        ),
      });

      const rows = section.figures.map((figure, i) =>
        new TableRow({
          children: [figure.label, String(figure.value)].map(
            (text) =>
              new TableCell({
                shading: i % 2 === 0 ? { type: ShadingType.CLEAR, fill: theme.wash } : undefined,
                children: [
                  new Paragraph({ children: [new TextRun({ text, size: 21, color: theme.ink })] }),
                ],
              })
          ),
        })
      );

      children.push(
        new Paragraph({ spacing: { before: 120 }, children: [] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }) as never
      );
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
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

  const theme = pickTheme(request.theme, request.title);

  /** Put a decorative cluster on a slide. Shapes only — nothing is fetched. */
  type Slide = ReturnType<typeof deck.addSlide>;
  const decorate = (slide: Slide, marks: Mark[]) => {
    for (const mark of marks) {
      slide.addShape(deck.ShapeType[mark.shape], {
        x: mark.x,
        y: mark.y,
        w: mark.w,
        h: mark.h,
        ...(mark.fill ? { fill: { color: mark.fill, transparency: mark.transparency ?? 0 } } : {}),
        ...(mark.line
          ? { line: { color: mark.line, width: mark.lineWidth ?? 1, transparency: mark.transparency ?? 0 } }
          : {}),
        ...(mark.rotate ? { rotate: mark.rotate } : {}),
      });
    }
  };

  // --- the title slide ---
  const title = deck.addSlide();
  title.background = { color: theme.paper };

  // A broad wash behind everything, and a solid bar the title sits against, so
  // the first slide is a composition rather than words floating in space.
  title.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.63, fill: { color: theme.wash } });
  title.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 5.63, fill: { color: theme.accent } });
  decorate(title, titleMotif(theme));

  title.addText(request.title, {
    x: 0.85, y: 1.9, w: 5.6, h: 1.4,
    fontSize: 40, bold: true, color: theme.heading, valign: "bottom",
  });
  title.addShape(deck.ShapeType.rect, { x: 0.9, y: 3.42, w: 1.2, h: 0.055, fill: { color: theme.accent } });
  if (request.subtitle) {
    title.addText(request.subtitle, {
      x: 0.85, y: 3.65, w: 5.6, h: 0.8,
      fontSize: 17, color: theme.ink, transparency: 25,
    });
  }

  // --- the rest ---
  const sections = request.sections ?? [];
  sections.forEach((section, index) => {
    const slide = deck.addSlide();
    slide.background = { color: theme.paper };
    const points = [...(section.bullets ?? []), ...(section.paragraphs ?? [])];
    const hasFigures = Boolean(section.figures && section.figures.length > 0);
    // Numbers win. A section that carries figures is a chart slide with a line
    // of prose above it, never a statement slide that quietly drops the
    // numbers — which is exactly what the auto-layout below used to do to it.
    const layout = hasFigures
      ? "figures"
      : section.layout ?? (points.length === 1 && points[0].length < 120 ? "statement" : "bullets");

    // A whole slide given to one sentence, in large type on colour.
    if (layout === "statement" && points.length > 0) {
      slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.63, fill: { color: theme.accent } });
      slide.addShape(deck.ShapeType.ellipse, {
        x: 7.6, y: -1.1, w: 4, h: 4, fill: { color: theme.onAccent, transparency: 88 },
      });
      slide.addShape(deck.ShapeType.ellipse, {
        x: -1.2, y: 3.3, w: 3, h: 3, fill: { color: theme.onAccent, transparency: 92 },
      });
      if (section.heading) {
        slide.addText(section.heading.toUpperCase(), {
          x: 0.9, y: 1.15, w: 8.2, h: 0.4,
          fontSize: 12, bold: true, color: theme.onAccent, charSpacing: 3, transparency: 25,
        });
      }
      slide.addText(points[0], {
        x: 0.9, y: 1.7, w: 8.2, h: 2.4,
        fontSize: 32, bold: true, color: theme.onAccent, valign: "top",
      });
      return;
    }

    // Every other slide shares a header: a tinted band, the heading in colour,
    // a rule under it, and the slide's number in a circle.
    slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.15, fill: { color: theme.wash } });
    slide.addShape(deck.ShapeType.rect, { x: 0, y: 1.15, w: 10, h: 0.045, fill: { color: theme.accent } });
    slide.addText(section.heading ?? "", {
      x: 0.85, y: 0.24, w: 7.6, h: 0.7,
      fontSize: 26, bold: true, color: theme.heading, valign: "middle",
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: 8.95, y: 0.34, w: 0.5, h: 0.5, fill: { color: theme.accent },
    });
    slide.addText(String(index + 1), {
      x: 8.95, y: 0.34, w: 0.5, h: 0.5,
      fontSize: 14, bold: true, color: theme.onAccent, align: "center", valign: "middle",
    });

    if (layout === "quote" && points.length > 0) {
      slide.addShape(deck.ShapeType.rect, { x: 0.85, y: 1.75, w: 0.07, h: 2.4, fill: { color: theme.accent } });
      slide.addText(`"${points[0]}"`, {
        x: 1.2, y: 1.75, w: 7.2, h: 2.0,
        fontSize: 22, italic: true, color: theme.heading, valign: "top",
      });
      if (section.attribution) {
        slide.addText(`— ${section.attribution}`, {
          x: 1.2, y: 3.85, w: 7.2, h: 0.4, fontSize: 14, color: theme.accent2,
        });
      }
      decorate(slide, motif(index, theme));
      return;
    }

    // Numbers, drawn as bars. Only ever what was given — nothing is invented to
    // make the picture look fuller.
    if (layout === "figures" && section.figures) {
      const figures = section.figures.slice(0, 5);
      const largest = Math.max(...figures.map((f) => Math.abs(f.value)), 1);
      const columnWidth = 8.3 / figures.length;

      // The bars hang from a fixed baseline, and the tallest is short enough
      // that its value label still clears the caption above it. Sized from the
      // caption downwards rather than guessed: a number sitting on top of a
      // sentence is the one way a chart can look broken.
      const baseline = 4.25;
      const tallest = 1.85;

      figures.forEach((figure, i) => {
        const height = Math.max(0.15, (Math.abs(figure.value) / largest) * tallest);
        const x = 0.85 + i * columnWidth + columnWidth * 0.18;
        const w = columnWidth * 0.64;
        slide.addShape(deck.ShapeType.roundRect, {
          x, y: baseline - height, w, h: height,
          fill: { color: i % 2 === 0 ? theme.accent : theme.accent2 },
        });
        slide.addText(String(figure.value), {
          x, y: baseline - height - 0.42, w, h: 0.38,
          fontSize: 14, bold: true, color: theme.heading, align: "center", valign: "bottom",
        });
        slide.addText(figure.label, {
          x, y: baseline + 0.07, w, h: 0.5,
          fontSize: 11, color: theme.ink, align: "center", valign: "top",
        });
      });

      if (points.length > 0) {
        slide.addText(points[0], {
          x: 0.85, y: 1.42, w: 8.3, h: 0.4, fontSize: 14, color: theme.ink, transparency: 20,
          valign: "top",
        });
      }
      return;
    }

    // Bullets, with a coloured square for a marker rather than a black dot —
    // and split into two columns when there are enough to be a wall of text.
    const asText = (list: string[]) =>
      list.map((text) => ({
        text,
        options: { bullet: { characterCode: "25AA" }, breakLine: true, paraSpaceAfter: 10 },
      }));

    if (layout === "columns" && points.length > 2) {
      const half = Math.ceil(points.length / 2);
      slide.addText(asText(points.slice(0, half)), {
        x: 0.85, y: 1.6, w: 4.0, h: 3.3, fontSize: 15, color: theme.ink, valign: "top",
      });
      slide.addText(asText(points.slice(half)), {
        x: 5.15, y: 1.6, w: 4.0, h: 3.3, fontSize: 15, color: theme.ink, valign: "top",
      });
      slide.addShape(deck.ShapeType.rect, {
        x: 5.0, y: 1.7, w: 0.02, h: 2.9, fill: { color: theme.accent2, transparency: 55 },
      });
      return;
    }

    if (points.length > 0) {
      slide.addText(asText(points), {
        x: 0.9, y: 1.6, w: 7.3, h: 3.4, fontSize: 17, color: theme.ink, valign: "top",
      });
    }
    decorate(slide, motif(index, theme));
  });

  // pptxgenjs types its Node output loosely; it is a Buffer here.
  const data = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
  fs.writeFileSync(target, data);
  return `${sections.length + 1} slides`;
}

async function writeSpreadsheet(request: DocumentRequest, target: string): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const theme = pickTheme(request.theme, request.title);
  const sheets = request.sheets ?? [];
  if (sheets.length === 0) {
    throw new Error("A spreadsheet needs at least one sheet of data, sir.");
  }

  let rowCount = 0;
  sheets.forEach((sheet, index) => {
    // Sheet names have their own rules, and a duplicate name throws.
    const cleaned = (sheet.name || `Sheet${index + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
    const worksheet = workbook.addWorksheet(cleaned.trim() || `Sheet${index + 1}`, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const columns = sheet.columns ?? [];
    const rows = sheet.rows ?? [];

    if (columns.length > 0) {
      const header = worksheet.addRow(columns);
      header.height = 22;
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: `FF${theme.onAccent}` }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${theme.accent}` } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = { bottom: { style: "thin", color: { argb: `FF${theme.heading}` } } };
      });
      // A filter on the header is the first thing anyone reaches for.
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };
    }

    for (const row of rows) {
      const added = worksheet.addRow(row);
      rowCount++;
      added.eachCell((cell, column) => {
        cell.font = { color: { argb: `FF${theme.ink}` }, size: 11 };
        // Banded rows, so the eye keeps its place across a wide table.
        if (rowCount % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${theme.wash}` } };
        }
        // Numbers right, with thousands separators; text left. Excel aligns
        // this way itself, but only once it has decided a cell is a number,
        // and it does not always agree with what was meant.
        const value = row[column - 1];
        if (typeof value === "number") {
          cell.numFmt = Number.isInteger(value) ? "#,##0" : "#,##0.00";
          cell.alignment = { horizontal: "right" };
        }
      });
    }

    // A total row wherever a column is entirely numbers, written as a real
    // SUM formula rather than a number — so it stays right when he edits a cell.
    const numeric = columns
      .map((_, i) => i)
      .filter((i) => rows.length > 0 && rows.every((row) => typeof row[i] === "number"));

    if (numeric.length > 0 && rows.length > 1) {
      const totals = worksheet.addRow([]);
      totals.getCell(1).value = "Total";
      for (const i of numeric) {
        const letter = worksheet.getColumn(i + 1).letter;
        totals.getCell(i + 1).value = { formula: `SUM(${letter}2:${letter}${rows.length + 1})` };
      }
      totals.eachCell((cell, column) => {
        cell.font = { bold: true, color: { argb: `FF${theme.heading}` }, size: 11 };
        cell.border = { top: { style: "double", color: { argb: `FF${theme.accent}` } } };
        if (numeric.includes(column - 1)) {
          cell.numFmt = "#,##0.00";
          cell.alignment = { horizontal: "right" };
        }
      });
    }

    // Width from the longest cell, so numbers never open as a row of hashes.
    worksheet.columns.forEach((column, i) => {
      const longest = Math.max(
        (columns[i] ?? "").length,
        ...rows.map((row) => String(row[i] ?? "").length)
      );
      column.width = Math.min(Math.max(longest + 4, 12), 60);
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
