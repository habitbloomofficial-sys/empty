// What a document Axis makes should look like.
//
// He used to produce black text on white: correct, complete and lifeless. A
// deck of bullet points is not a deck, it is a list that has been made larger.
//
// So: a small set of palettes, and a set of motifs drawn from PowerPoint's own
// shapes. Nothing is fetched — every mark on the page is a rectangle, a circle
// or a triangle placed deliberately, which means it always works, never fails
// to load, and costs nothing.

export interface Theme {
  name: string;
  /** Body text. Near-black rather than black; pure black on white is harsh. */
  ink: string;
  /** Headings and titles. */
  heading: string;
  /** The colour that carries the design. */
  accent: string;
  /** A second, for alternation and depth. */
  accent2: string;
  /** A pale tint of the accent, for bands and fills. */
  wash: string;
  /** Slide background. */
  paper: string;
  /** Text placed on top of the accent. */
  onAccent: string;
}

// Six, each built round one hue so nothing ever clashes with itself. Hex
// without the hash, which is what both pptxgenjs and docx take.
export const THEMES: Record<string, Theme> = {
  midnight: {
    name: "midnight",
    ink: "1F2430", heading: "16213E", accent: "E8A33D", accent2: "3D5A80",
    wash: "F3F0E8", paper: "FFFFFF", onAccent: "16213E",
  },
  ocean: {
    name: "ocean",
    ink: "1D2B33", heading: "0B3C5D", accent: "2A9D8F", accent2: "1D6A96",
    wash: "EAF4F3", paper: "FFFFFF", onAccent: "FFFFFF",
  },
  ember: {
    name: "ember",
    ink: "2B1D1A", heading: "6B2C20", accent: "E76F51", accent2: "F4A261",
    wash: "FDF0EC", paper: "FFFFFF", onAccent: "FFFFFF",
  },
  forest: {
    name: "forest",
    ink: "1C2620", heading: "234E36", accent: "5A9367", accent2: "A3B18A",
    wash: "EDF3ED", paper: "FFFFFF", onAccent: "FFFFFF",
  },
  berry: {
    name: "berry",
    ink: "26202E", heading: "5B2A63", accent: "9B5DE5", accent2: "C77DFF",
    wash: "F5EEFB", paper: "FFFFFF", onAccent: "FFFFFF",
  },
  slate: {
    name: "slate",
    ink: "22262A", heading: "2F3E46", accent: "52796F", accent2: "84A98C",
    wash: "EFF2F1", paper: "FFFFFF", onAccent: "FFFFFF",
  },
};

export const THEME_NAMES = Object.keys(THEMES);

/**
 * Which palette to use.
 *
 * A named one when asked for. Otherwise one chosen from the title, so the same
 * document is the same colour every time it is made — a deck that changes
 * colour when you regenerate it feels broken, even though nothing is wrong.
 */
export function pickTheme(name?: string, seed = ""): Theme {
  const wanted = name?.trim().toLowerCase();
  if (wanted && THEMES[wanted]) return THEMES[wanted];

  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return THEMES[THEME_NAMES[hash % THEME_NAMES.length]];
}

// --- the motifs ------------------------------------------------------------

export interface Mark {
  /** A pptxgenjs ShapeType name. */
  shape: "ellipse" | "roundRect" | "rect" | "triangle" | "chevron" | "donut" | "line";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  line?: string;
  lineWidth?: number;
  rotate?: number;
  transparency?: number;
}

/**
 * A decorative cluster for the corner of a slide.
 *
 * Six of them, chosen by slide number so a deck has variety without anything
 * having to decide. They live in the bottom-right, clear of a 16:9 slide's text
 * (which ends around x=9.2, y=5.0), and they are drawn from circles, arcs and
 * triangles — the vocabulary of every good deck ever made, and none of it
 * needs an image.
 */
export function motif(index: number, theme: Theme): Mark[] {
  const soft = 45;      // How far the second colour recedes.
  const faint = 70;

  switch (index % 6) {
    // Concentric rings, bottom right.
    case 0:
      return [
        { shape: "ellipse", x: 8.35, y: 3.9, w: 1.3, h: 1.3, line: theme.accent, lineWidth: 2 },
        { shape: "ellipse", x: 8.6, y: 4.15, w: 0.8, h: 0.8, line: theme.accent2, lineWidth: 2, transparency: soft },
        { shape: "ellipse", x: 8.82, y: 4.37, w: 0.36, h: 0.36, fill: theme.accent },
      ];

    // A stack of chevrons, marching off the edge.
    case 1:
      return [
        { shape: "chevron", x: 8.2, y: 4.1, w: 0.55, h: 0.9, fill: theme.accent, transparency: faint },
        { shape: "chevron", x: 8.6, y: 4.1, w: 0.55, h: 0.9, fill: theme.accent, transparency: soft },
        { shape: "chevron", x: 9.0, y: 4.1, w: 0.55, h: 0.9, fill: theme.accent },
      ];

    // Triangles, one solid and one outlined, slightly turned.
    case 2:
      return [
        { shape: "triangle", x: 8.35, y: 3.95, w: 1.15, h: 1.0, line: theme.accent2, lineWidth: 2 },
        { shape: "triangle", x: 8.75, y: 4.25, w: 0.7, h: 0.62, fill: theme.accent, rotate: 15 },
      ];

    // A dotted grid — the quietest of them.
    case 3: {
      const dots: Mark[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          dots.push({
            shape: "ellipse",
            x: 8.3 + col * 0.32,
            y: 4.1 + row * 0.32,
            w: 0.14,
            h: 0.14,
            fill: row === 1 && col === 2 ? theme.accent : theme.accent2,
            transparency: row === 1 && col === 2 ? 0 : faint,
          });
        }
      }
      return dots;
    }

    // A ring cut by a bar.
    case 4:
      return [
        { shape: "donut", x: 8.4, y: 3.95, w: 1.1, h: 1.1, fill: theme.accent2, transparency: soft },
        { shape: "roundRect", x: 8.15, y: 4.4, w: 1.6, h: 0.2, fill: theme.accent },
      ];

    // Stacked bars of different weights, like a tiny chart.
    default:
      return [
        { shape: "roundRect", x: 8.35, y: 4.65, w: 0.28, h: 0.45, fill: theme.accent2, transparency: soft },
        { shape: "roundRect", x: 8.72, y: 4.35, w: 0.28, h: 0.75, fill: theme.accent },
        { shape: "roundRect", x: 9.09, y: 4.5, w: 0.28, h: 0.6, fill: theme.accent2 },
      ];
  }
}

/**
 * The cluster for the title slide, which gets something larger.
 *
 * Placed to the right of the title block, big enough to be the second thing you
 * look at and never big enough to be the first.
 */
export function titleMotif(theme: Theme): Mark[] {
  return [
    { shape: "ellipse", x: 6.9, y: 1.15, w: 2.9, h: 2.9, line: theme.accent, lineWidth: 3, transparency: 30 },
    { shape: "ellipse", x: 7.55, y: 1.8, w: 1.6, h: 1.6, fill: theme.accent, transparency: 25 },
    { shape: "donut", x: 6.35, y: 2.85, w: 1.15, h: 1.15, fill: theme.accent2, transparency: 40 },
    { shape: "triangle", x: 8.9, y: 3.55, w: 0.75, h: 0.65, fill: theme.accent2, rotate: 12 },
    { shape: "ellipse", x: 6.6, y: 0.85, w: 0.3, h: 0.3, fill: theme.accent2 },
  ];
}
