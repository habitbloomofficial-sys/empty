import fs from "node:fs";
import path from "node:path";
import { outputFolder, safeFilename, uniquePath } from "./documents";
import { extrude, isWatertight, toStl, translate, type Point, type Triangle } from "./mesh";

// A case for a phone.
//
// This does not go through the parts-list route the other models take, and the
// reason is worth stating. A case is a wall following a rounded rectangle, with
// gaps cut out of it for the port and the buttons, and a back with a window for
// the camera. Expressed as a parts list that is sixty-odd outline points that
// have to be right to a tenth of a millimetre, and a model asked to produce
// them will produce something that looks like a case and does not fit a phone.
// Expressed as parameters — how big is the phone, how thick a wall, where is
// the camera — it is arithmetic, and arithmetic can be checked.
//
// There is still no boolean subtraction anywhere. The back is an extruded
// outline with the camera window as a hole in it, which the extruder already
// does. The wall is the interesting one: rather than cutting gaps out of a
// ring, the perimeter is walked, the samples that fall inside an opening are
// dropped, and each surviving run is extruded as its own closed band. Gaps by
// omission rather than subtraction.

/** Two ways the fit can be wrong, and only one of them can be fixed afterwards. */
const CLEARANCE_MM = 0.4;
const WALL_MM = 2;
const BACK_MM = 1.2;
/** How far the wall stands proud of the screen, so a face-down phone rests on the case. */
const LIP_MM = 1.4;

export interface PhoneSize {
  name: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  /** The radius of the phone's own corners. */
  cornerRadiusMm: number;
  /** The camera island, as a window in the back: width, height, and where its middle sits. */
  camera: { widthMm: number; heightMm: number; fromTopMm: number; fromLeftMm: number };
}

/**
 * Phones I have figures for.
 *
 * These are published dimensions, not measured ones, and published dimensions
 * are the body of the phone — they do not include a camera bump, and different
 * sources round them differently. Every answer says so and offers the version
 * where he measures it himself, because a case is the one thing where being
 * half a millimetre out means it does not go on.
 */
export const PHONES: Record<string, PhoneSize> = {
  "samsung galaxy a35": {
    name: "Samsung Galaxy A35 5G",
    widthMm: 78,
    heightMm: 161.7,
    thicknessMm: 8.2,
    cornerRadiusMm: 12,
    // The A35 carries three separate lenses in a vertical line at the top left
    // rather than one island, so the window is a tall slot that clears all of
    // them with room to spare.
    camera: { widthMm: 22, heightMm: 46, fromTopMm: 10, fromLeftMm: 9 },
  },
  "samsung galaxy a55": {
    name: "Samsung Galaxy A55 5G",
    widthMm: 77.2,
    heightMm: 161.1,
    thicknessMm: 8.2,
    cornerRadiusMm: 12,
    camera: { widthMm: 22, heightMm: 46, fromTopMm: 10, fromLeftMm: 9 },
  },
  "iphone 15": {
    name: "iPhone 15",
    widthMm: 71.6,
    heightMm: 147.6,
    thicknessMm: 7.8,
    cornerRadiusMm: 12,
    camera: { widthMm: 38, heightMm: 38, fromTopMm: 12, fromLeftMm: 8 },
  },
  "iphone 15 pro": {
    name: "iPhone 15 Pro",
    widthMm: 70.6,
    heightMm: 146.6,
    thicknessMm: 8.25,
    cornerRadiusMm: 12,
    camera: { widthMm: 40, heightMm: 40, fromTopMm: 11, fromLeftMm: 7 },
  },
  "google pixel 8": {
    name: "Google Pixel 8",
    widthMm: 70.8,
    heightMm: 150.5,
    thicknessMm: 8.9,
    cornerRadiusMm: 12,
    // The Pixel's camera bar runs the full width, so the window does too.
    camera: { widthMm: 66, heightMm: 20, fromTopMm: 22, fromLeftMm: 2.4 },
  },
};

export const PHONE_NAMES = Object.keys(PHONES);

export function findPhone(name: string): PhoneSize | null {
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (PHONES[key]) return PHONES[key];

  const entries = Object.entries(PHONES);
  const exact = entries.find(([id]) => id === key);
  if (exact) return exact[1];

  // "a35", "galaxy a35 5g", "samsung a35" should all land on the same phone.
  const words = key.split(" ").filter(Boolean);
  const scored = entries
    .map(([id, phone]) => {
      const haystack = `${id} ${phone.name.toLowerCase()}`;
      const hits = words.filter((word) => haystack.includes(word)).length;
      return { phone, hits };
    })
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return scored.length > 0 && scored[0].hits === words.length ? scored[0].phone : null;
}

/** Which side of the case an opening is on. Corners are never opened. */
export type Side = "bottom" | "right" | "top" | "left";

export interface Opening {
  side: Side;
  /** Millimetres from the middle of that side. Positive is towards the top, or the right. */
  centreMm: number;
  widthMm: number;
  label: string;
}

interface Sample {
  point: Point;
  side: Side | "corner";
  /** Millimetres from the middle of the side this sample sits on. */
  offsetMm: number;
}

/**
 * Walk a rounded rectangle, recording which side each point is on.
 *
 * Sampled structurally rather than by arc length: the same number of points per
 * edge and per corner every time, so a point on the inner outline and the point
 * with the same index on the outer outline are the same place on the case. That
 * correspondence is what lets the wall be built as a band between them.
 */
function walk(
  width: number,
  height: number,
  radius: number,
  openings: Opening[] = [],
  perCorner = 8
): Sample[] {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  const flatW = width - 2 * r;
  const flatH = height - 2 * r;

  // Roughly a point every two millimetres along the straights, which is finer
  // than any printer resolves and keeps an opening edge within a hair of where
  // it was asked for.
  const perEdge = (length: number) => Math.max(2, Math.round(length / 2));
  const samples: Sample[] = [];

  const edge = (side: Side, from: Point, to: Point, length: number) => {
    const steps = perEdge(length);
    const grid: number[] = [];
    for (let i = 0; i < steps; i++) grid.push(i / steps);
    const boundaries: number[] = [];

    // The exact edges of every opening on this side, added to the regular
    // spacing. Without them a gap can only end where a sample happens to fall,
    // so a 34 mm port asked for on a 2 mm grid comes out 38 mm — wide enough
    // to notice on the phone and wrong for no good reason. The two outlines
    // are walked with the same lengths and the same openings, so they end up
    // with the same points at the same indices, which is what lets the wall be
    // built as a band between them.
    for (const opening of openings) {
      if (opening.side !== side) continue;
      const sense = side === "top" || side === "left" ? -1 : 1;
      for (const edgeOffset of [
        opening.centreMm - opening.widthMm / 2,
        opening.centreMm + opening.widthMm / 2,
      ]) {
        const t = (edgeOffset * sense) / length + 0.5;
        if (t > 1e-9 && t < 1 - 1e-9) boundaries.push(t);
      }
    }

    // A boundary that lands on top of a grid point leaves two points a
    // femtometre apart, which is a zero-length edge, which is a hole in the
    // solid. So the boundary wins and the grid point next to it goes: at five
    // hundredths of a millimetre nothing is lost, and the outline stays a
    // proper polygon.
    const snap = 0.05 / length;
    const stops = [
      ...grid.filter((t) => !boundaries.some((b) => Math.abs(b - t) < snap)),
      ...boundaries,
    ];

    for (const t of stops.sort((a, b) => a - b)) {
      samples.push({
        point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        side,
        offsetMm: (t - 0.5) * length,
      });
    }
  };

  const corner = (cx: number, cy: number, startAngle: number) => {
    for (let i = 0; i < perCorner; i++) {
      const angle = startAngle + (i / perCorner) * (Math.PI / 2);
      samples.push({
        point: { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r },
        side: "corner",
        offsetMm: 0,
      });
    }
  };

  // Anticlockwise from the bottom-left of the bottom edge.
  edge("bottom", { x: -flatW / 2, y: -halfH }, { x: flatW / 2, y: -halfH }, flatW);
  corner(flatW / 2, -flatH / 2, -Math.PI / 2);
  edge("right", { x: halfW, y: -flatH / 2 }, { x: halfW, y: flatH / 2 }, flatH);
  corner(flatW / 2, flatH / 2, 0);
  edge("top", { x: flatW / 2, y: halfH }, { x: -flatW / 2, y: halfH }, flatW);
  corner(-flatW / 2, flatH / 2, Math.PI / 2);
  edge("left", { x: -halfW, y: flatH / 2 }, { x: -halfW, y: -flatH / 2 }, flatH);
  corner(-flatW / 2, -flatH / 2, Math.PI);

  return samples;
}

/** The outline on its own, for the back plate and the camera window. */
export function roundedRect(width: number, height: number, radius: number, perCorner = 8): Point[] {
  return walk(width, height, radius, [], perCorner).map((s) => s.point);
}

/**
 * The wall, with its openings.
 *
 * Every sample is asked whether it falls inside an opening. The ones that do
 * are dropped, and each surviving run of consecutive samples becomes one closed
 * band — out along the outside, back along the inside. A run is a simple
 * polygon, so it extrudes to a solid with no holes in it, and the gaps between
 * runs are the port and the buttons.
 *
 * The offsets run along the side the sample is on, and the top edge is walked
 * right-to-left, so its sense is flipped: "20 mm to the right" means the same
 * thing on the top of the case as on the bottom.
 */
function wallRuns(
  inner: Sample[],
  outer: Sample[],
  openings: Opening[],
  height: number
): Triangle[] {
  const opened = inner.map((sample) => {
    if (sample.side === "corner") return false;
    return openings.some((opening) => {
      if (opening.side !== sample.side) return false;
      const sense = sample.side === "top" || sample.side === "left" ? -1 : 1;
      // Strictly inside: a sample sitting exactly on the boundary is the edge
      // of the gap and belongs to the wall, which is what makes the opening
      // come out the width it was asked for.
      return Math.abs(sample.offsetMm * sense - opening.centreMm) < opening.widthMm / 2 - 1e-6;
    });
  });

  // No openings at all is an unbroken ring, which the extruder already makes
  // properly as an outline with a hole in it. Running it through the band code
  // would produce one polygon that meets itself, which is not a polygon.
  if (!opened.some(Boolean)) {
    return extrude(
      { outline: outer.map((s) => s.point), holes: [inner.map((s) => s.point)] },
      height
    );
  }
  const count = inner.length;
  // Start from a sample that is inside an opening, so the first run found is a
  // whole one rather than the tail of a run that wraps around the end.
  const start = opened.indexOf(true);

  const triangles: Triangle[] = [];
  let run: number[] = [];
  const flush = () => {
    // Two samples make a line, not a band.
    if (run.length >= 2) {
      const outline = [
        ...run.map((i) => outer[i].point),
        ...[...run].reverse().map((i) => inner[i].point),
      ];
      triangles.push(...extrude({ outline }, height));
    }
    run = [];
  };

  for (let step = 0; step < count; step++) {
    const i = (start + step) % count;
    if (opened[i]) flush();
    else run.push(i);
  }
  flush();

  return triangles;
}

export interface CaseSpec {
  phone: PhoneSize;
  clearanceMm: number;
  wallMm: number;
  backMm: number;
  lipMm: number;
  openings: Opening[];
  /** Left out, the camera window from the phone's own figures is used. */
  cameraWindow: boolean;
}

export interface BuiltCase {
  triangles: Triangle[];
  /** Outside, in millimetres. */
  sizeMm: [number, number, number];
  /** The pocket the phone sits in. */
  cavityMm: [number, number, number];
  watertight: boolean;
}

export function buildCase(spec: CaseSpec): BuiltCase {
  const { phone, clearanceMm, wallMm, backMm, lipMm } = spec;

  const innerW = phone.widthMm + clearanceMm * 2;
  const innerH = phone.heightMm + clearanceMm * 2;
  const innerR = phone.cornerRadiusMm + clearanceMm;
  const outerW = innerW + wallMm * 2;
  const outerH = innerH + wallMm * 2;
  const outerR = innerR + wallMm;
  const wallHeight = phone.thicknessMm + clearanceMm + lipMm;

  // An opening has to fit on the side it is on. The corners are structural —
  // they are what holds the case together and they are never opened — so an
  // opening wider than the straight part of its side is a mistake, and saying
  // so is more use than quietly clipping it to fit.
  const flat = {
    bottom: innerW - 2 * innerR,
    top: innerW - 2 * innerR,
    left: innerH - 2 * innerR,
    right: innerH - 2 * innerR,
  };
  for (const opening of spec.openings) {
    const available = flat[opening.side];
    if (opening.widthMm <= 0) {
      throw new Error(`A ${opening.widthMm} mm opening for the ${opening.label} isn't an opening, sir.`);
    }
    if (opening.widthMm >= available) {
      throw new Error(
        `The ${opening.label} gap is ${opening.widthMm.toFixed(0)} mm, but the straight part of the ${opening.side} is only ${available.toFixed(0)} mm, sir — that would cut the corners off and leave no wall at all.`
      );
    }
    const reach = Math.abs(opening.centreMm) + opening.widthMm / 2;
    if (reach > available / 2) {
      throw new Error(
        `The ${opening.label} gap runs ${(reach - available / 2).toFixed(0)} mm past the end of the ${opening.side} and into the corner, sir. Move it towards the middle.`
      );
    }
  }

  const innerPath = walk(innerW, innerH, innerR, spec.openings);
  const outerPath = walk(outerW, outerH, outerR, spec.openings);

  // The back, with the camera window through it. The window is given from the
  // top-left corner of the phone, which is how anyone reads a phone's back.
  const cameraHole: Point[][] = [];
  if (spec.cameraWindow) {
    const { widthMm, heightMm, fromTopMm, fromLeftMm } = phone.camera;
    const centreX = -innerW / 2 + fromLeftMm + widthMm / 2;
    const centreY = innerH / 2 - fromTopMm - heightMm / 2;
    const radius = Math.min(widthMm, heightMm) / 4;
    cameraHole.push(
      roundedRect(widthMm, heightMm, radius).map((p) => ({
        x: p.x + centreX,
        y: p.y + centreY,
      }))
    );
  }

  const back = extrude(
    { outline: outerPath.map((s) => s.point), holes: cameraHole },
    backMm
  );
  const wall = translate(wallRuns(innerPath, outerPath, spec.openings, wallHeight), { z: backMm });

  const triangles = [...back, ...wall];
  return {
    triangles,
    sizeMm: [outerW, outerH, backMm + wallHeight],
    cavityMm: [innerW, innerH, wallHeight],
    watertight: isWatertight(triangles).closed,
  };
}

export interface CaseRequest {
  /** A phone by name, if it is one I have figures for. */
  phone?: string;
  /** Or his own measurements, which beat any published figure. */
  widthMm?: number;
  heightMm?: number;
  thicknessMm?: number;
  cornerRadiusMm?: number;
  clearanceMm?: number;
  wallMm?: number;
  backMm?: number;
  lipMm?: number;
  cameraWindow?: boolean;
  /** Extra gaps beyond the port and buttons, or a replacement set. */
  openings?: Opening[];
}

export interface DesignedCase extends BuiltCase {
  path: string;
  filename: string;
  folder: string;
  spec: CaseSpec;
  /** True when the figures came from the table rather than from him. */
  fromTable: boolean;
  notes: string[];
  cautions: string[];
}

/**
 * The openings a case needs if nobody says otherwise.
 *
 * Every phone made in the last decade has its charging port and speaker on the
 * bottom middle and its buttons up the right-hand side, so these are the right
 * defaults — and they are stated in the answer so a phone that does it
 * differently can be corrected in one sentence.
 */
function defaultOpenings(phone: PhoneSize): Opening[] {
  return [
    { side: "bottom", centreMm: 0, widthMm: Math.min(34, phone.widthMm * 0.45), label: "charging port and speaker" },
    { side: "right", centreMm: phone.heightMm * 0.16, widthMm: phone.heightMm * 0.3, label: "power and volume buttons" },
  ];
}

export function designCase(request: CaseRequest): DesignedCase {
  let phone: PhoneSize | null = null;
  let fromTable = false;

  if (request.phone) {
    phone = findPhone(request.phone);
    if (!phone && !(request.widthMm && request.heightMm && request.thicknessMm)) {
      throw new Error(
        `I don't have figures for a "${request.phone}", sir. I know ${Object.values(PHONES)
          .map((p) => p.name)
          .join(", ")} — or measure yours and give me the width, height and thickness and I'll work from those.`
      );
    }
    fromTable = phone !== null;
  }

  // His own measurements always win over the table, field by field.
  const widthMm = request.widthMm ?? phone?.widthMm;
  const heightMm = request.heightMm ?? phone?.heightMm;
  const thicknessMm = request.thicknessMm ?? phone?.thicknessMm;
  if (!widthMm || !heightMm || !thicknessMm) {
    throw new Error(
      "I need the phone's width, height and thickness in millimetres, sir — or the name of a phone I have figures for."
    );
  }
  for (const [what, value, low, high] of [
    ["width", widthMm, 40, 200],
    ["height", heightMm, 80, 300],
    ["thickness", thicknessMm, 3, 30],
  ] as const) {
    if (value < low || value > high) {
      throw new Error(`A ${what} of ${value} mm isn't a phone, sir — I'd expect ${low} to ${high} mm.`);
    }
  }

  if (request.widthMm || request.heightMm || request.thicknessMm) fromTable = false;

  const resolved: PhoneSize = {
    name: phone?.name ?? "your phone",
    widthMm,
    heightMm,
    thicknessMm,
    cornerRadiusMm: request.cornerRadiusMm ?? phone?.cornerRadiusMm ?? 12,
    camera: phone?.camera ?? {
      widthMm: Math.min(30, widthMm * 0.4),
      heightMm: Math.min(46, heightMm * 0.3),
      fromTopMm: 10,
      fromLeftMm: 9,
    },
  };

  const spec: CaseSpec = {
    phone: resolved,
    clearanceMm: request.clearanceMm ?? CLEARANCE_MM,
    wallMm: request.wallMm ?? WALL_MM,
    backMm: request.backMm ?? BACK_MM,
    lipMm: request.lipMm ?? LIP_MM,
    cameraWindow: request.cameraWindow ?? true,
    openings: request.openings ?? defaultOpenings(resolved),
  };

  const built = buildCase(spec);

  const folder = path.join(outputFolder(), "Models");
  fs.mkdirSync(folder, { recursive: true });
  const target = uniquePath(folder, safeFilename(`${resolved.name} case`.slice(0, 60), "stl"));
  fs.writeFileSync(target, toStl(built.triangles, `Axis — case for ${resolved.name}`));

  const notes = [
    `Outside ${built.sizeMm[0].toFixed(1)} × ${built.sizeMm[1].toFixed(1)} × ${built.sizeMm[2].toFixed(1)} mm.`,
    `The pocket is ${built.cavityMm[0].toFixed(1)} × ${built.cavityMm[1].toFixed(1)} mm — the phone plus ${spec.clearanceMm} mm of clearance all round.`,
    `${spec.wallMm} mm walls, a ${spec.backMm} mm back, and the wall stands ${spec.lipMm} mm proud of the screen so it doesn't rest face-down on the glass.`,
    `Openings: ${spec.openings.map((o) => `${o.label} (${o.widthMm.toFixed(0)} mm on the ${o.side})`).join(", ")}.`,
    spec.cameraWindow
      ? `A ${resolved.camera.widthMm} × ${resolved.camera.heightMm} mm window in the back for the cameras, ${resolved.camera.fromTopMm} mm from the top and ${resolved.camera.fromLeftMm} mm from the left.`
      : "No camera window — the back is solid.",
  ];

  const cautions = [
    "Print it in TPU. A case has to stretch over the phone to go on, and a rigid one in PLA or PETG either will not go on or will snap doing it.",
    `The fit is set by the ${spec.clearanceMm} mm clearance. If it goes on too tight ask me for 0.6, if it is loose ask me for 0.3 — that one number is the whole difference, and it is quicker than reprinting twice.`,
  ];

  if (fromTable) {
    cautions.push(
      `These are ${resolved.name}'s published dimensions, not measured ones. Published figures are the body of the phone and do not include the camera bump, and different sources round them differently. Measure yours with calipers if you have them and I will rebuild it from your numbers — a case is the one thing where half a millimetre decides whether it goes on.`
    );
  }
  cautions.push(
    "The port and button gaps are where they are on almost every phone — bottom middle, and up the right-hand side. Check that against yours before printing and I will move them if not."
  );

  return {
    ...built,
    path: target,
    filename: path.basename(target),
    folder,
    spec,
    fromTable,
    notes,
    cautions,
  };
}
