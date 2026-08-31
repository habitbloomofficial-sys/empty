import fs from "node:fs";
import path from "node:path";
import { outputFolder, safeFilename, uniquePath } from "./documents";
import { extrude, isWatertight, toStl, translate, type Point, type Triangle } from "./mesh";
import { bounds } from "./section";
import * as solids from "./solids";

// Turning "make me a phone stand" into a solid.
//
// The brain does not write geometry. It writes a parts list — this shape, this
// big, here, turned this way — and this file builds it. That division is the
// whole design, and it is worth being clear about why, because the obvious
// alternative is to let a model emit triangles or OpenSCAD directly.
//
// A model asked for triangles produces a mesh that looks plausible and has
// holes in it, every time. A model asked for a parts list produces a parts
// list, and a parts list can be checked: every number is validated before
// anything is built, every shape is generated closed, and what comes out is
// watertight because it could not have been anything else. The model is doing
// what it is good at — knowing that a phone stand is a base, a back and a lip
// — and not doing what it is bad at.
//
// The cost is that it can only build things the shape language can express.
// That is a real limit, it is stated plainly in the tool description, and it
// buys a file that always slices.

/** Nothing sensible is a metre across, and a stray zero should not become one. */
const MAX_MM = 1000;
const MIN_MM = 0.1;
const MAX_PIECES = 64;
const MAX_TRIANGLES = 400_000;

export type ShapeName =
  | "box"
  | "cylinder"
  | "tube"
  | "cone"
  | "sphere"
  | "wedge"
  | "prism"
  | "torus"
  | "plate"
  | "extrude"
  | "revolve";

export interface Piece {
  shape: ShapeName;
  /** Where the middle of the piece goes, in millimetres. */
  at?: [number, number, number];
  /** Degrees about X, then Y, then Z. */
  rotate?: [number, number, number];

  width?: number;
  depth?: number;
  height?: number;
  thickness?: number;
  radius?: number;
  /** The bore of a tube, or the hole through a torus's own tube. */
  bore?: number;
  topRadius?: number;
  tubeRadius?: number;
  sides?: number;

  /** For `plate`: round holes straight through, measured from the plate's middle. */
  holes?: { x: number; y: number; diameter: number }[];
  /** For `extrude` and `revolve`: the outline, as [x, y] pairs. */
  outline?: [number, number][];
  /** For `extrude`: holes through the outline, each its own closed loop. */
  cutouts?: [number, number][][];
  /** A note for the person reading the answer. Ignored by the geometry. */
  label?: string;
}

export interface ModelSpec {
  name: string;
  pieces: Piece[];
}

function number(value: unknown, what: string, piece: number, { min = MIN_MM, max = MAX_MM } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Piece ${piece + 1} needs a ${what}, sir, and I was given ${JSON.stringify(value)}.`);
  }
  if (value < min || value > max) {
    throw new Error(
      `Piece ${piece + 1}: a ${what} of ${value} mm isn't right, sir — I work between ${min} and ${max} mm.`
    );
  }
  return value;
}

function triple(value: unknown, what: string, piece: number): [number, number, number] {
  if (value === undefined) return [0, 0, 0];
  if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error(`Piece ${piece + 1}: ${what} should be three numbers, sir.`);
  }
  return value as [number, number, number];
}

function outlineOf(value: unknown, piece: number): Point[] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`Piece ${piece + 1} needs an outline of at least three points, sir.`);
  }
  return value.map((point, i) => {
    if (!Array.isArray(point) || point.length !== 2 || point.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error(`Piece ${piece + 1}, point ${i + 1}: an outline point is two numbers, sir.`);
    }
    if (Math.abs(point[0]) > MAX_MM || Math.abs(point[1]) > MAX_MM) {
      throw new Error(`Piece ${piece + 1}, point ${i + 1}: that's further than a metre from the middle, sir.`);
    }
    return { x: point[0], y: point[1] };
  });
}

/**
 * Build one piece, in its own coordinates, then put it where it goes.
 *
 * Rotation is X then Y then Z, applied about the piece's own middle before it
 * is moved — which is the order anyone means when they say "lay it down and
 * then turn it".
 */
export function buildPiece(piece: Piece, index = 0): Triangle[] {
  const n = (key: keyof Piece, what: string, options?: { min?: number; max?: number }) =>
    number(piece[key], what, index, options);

  let solid: Triangle[];
  switch (piece.shape) {
    case "box":
      solid = solids.box(n("width", "width"), n("depth", "depth"), n("height", "height"));
      break;
    case "cylinder":
      solid = solids.cylinder(n("radius", "radius"), n("height", "height"));
      break;
    case "tube": {
      const radius = n("radius", "radius");
      const bore = n("bore", "bore", { min: 0.05, max: MAX_MM });
      if (bore >= radius) {
        throw new Error(`Piece ${index + 1}: the bore (${bore}) has to be smaller than the tube (${radius}), sir.`);
      }
      solid = solids.tube(radius, bore, n("height", "height"));
      break;
    }
    case "cone":
      solid = solids.cone(
        n("radius", "radius"),
        piece.topRadius === undefined ? 0 : number(piece.topRadius, "top radius", index, { min: 0 }),
        n("height", "height")
      );
      break;
    case "sphere":
      solid = solids.sphere(n("radius", "radius"));
      break;
    case "wedge":
      solid = solids.wedge(n("width", "width"), n("depth", "depth"), n("height", "height"));
      break;
    case "prism": {
      const sides = number(piece.sides, "number of sides", index, { min: 3, max: 128 });
      solid = solids.prism(Math.round(sides), n("radius", "radius"), n("height", "height"));
      break;
    }
    case "torus": {
      const radius = n("radius", "radius");
      const tubeRadius = n("tubeRadius", "tube radius");
      if (tubeRadius >= radius) {
        throw new Error(`Piece ${index + 1}: a tube of ${tubeRadius} on a ring of ${radius} leaves no hole, sir.`);
      }
      solid = solids.torus(radius, tubeRadius);
      break;
    }
    case "plate": {
      const width = n("width", "width");
      const depth = n("depth", "depth");
      const thickness = n("thickness", "thickness");
      const holes = (piece.holes ?? []).map((hole, i) => {
        if (
          typeof hole?.x !== "number" ||
          typeof hole?.y !== "number" ||
          typeof hole?.diameter !== "number" ||
          !Number.isFinite(hole.x) ||
          !Number.isFinite(hole.y) ||
          !Number.isFinite(hole.diameter)
        ) {
          throw new Error(`Piece ${index + 1}, hole ${i + 1}: a hole needs x, y and a diameter, sir.`);
        }
        if (hole.diameter <= 0 || hole.diameter >= Math.min(width, depth)) {
          throw new Error(`Piece ${index + 1}, hole ${i + 1}: a ${hole.diameter} mm hole doesn't fit that plate, sir.`);
        }
        return hole;
      });
      solid = solids.plate(width, depth, thickness, holes);
      break;
    }
    case "extrude": {
      const outline = outlineOf(piece.outline, index);
      const cutouts = (piece.cutouts ?? []).map((loop) => outlineOf(loop, index));
      const thickness = n("thickness", "thickness");
      const flat = extrude({ outline, holes: cutouts }, thickness);
      // Extrusion builds from z = 0 up; everything else here is centred, so it
      // is brought onto the same convention before it is placed.
      const box = bounds(flat);
      solid = translate(flat, {
        x: -(box.min.x + box.max.x) / 2,
        y: -(box.min.y + box.max.y) / 2,
        z: -thickness / 2,
      });
      break;
    }
    case "revolve": {
      const outline = outlineOf(piece.outline, index);
      if (outline.some((p) => p.x < 0)) {
        throw new Error(`Piece ${index + 1}: a revolved outline can't cross its axis, sir — every x must be positive.`);
      }
      solid = solids.revolve(outline);
      break;
    }
    default:
      throw new Error(
        `I don't know how to make a "${String(piece.shape)}", sir. I have box, cylinder, tube, cone, sphere, wedge, prism, torus, plate, extrude and revolve.`
      );
  }

  const [rx, ry, rz] = triple(piece.rotate, "rotate", index);
  if (rx) solid = solids.rotateX(solid, rx);
  if (ry) solid = solids.rotateY(solid, ry);
  if (rz) solid = solids.rotateZ(solid, rz);

  const [x, y, z] = triple(piece.at, "at", index);
  return translate(solid, { x, y, z });
}

export interface BuiltModel {
  triangles: Triangle[];
  sizeMm: [number, number, number];
  watertight: boolean;
  boundaryEdges: number;
}

/**
 * Build the whole thing, and stand it on the bed.
 *
 * Pieces are expected to overlap — that is how they are joined, and every
 * slicer welds overlapping solids into one. What is not allowed is a piece
 * floating on its own with nothing touching it, because that prints as two
 * objects and falls apart in the hand; that is checked and reported rather
 * than discovered later.
 */
export function buildModel(spec: ModelSpec): BuiltModel {
  if (!spec?.pieces?.length) throw new Error("There are no pieces in that model, sir.");
  if (spec.pieces.length > MAX_PIECES) {
    throw new Error(`That's ${spec.pieces.length} pieces, sir — I cap it at ${MAX_PIECES} to keep the file sane.`);
  }

  const triangles: Triangle[] = [];
  for (const [index, piece] of spec.pieces.entries()) {
    triangles.push(...buildPiece(piece, index));
    if (triangles.length > MAX_TRIANGLES) {
      throw new Error("That model came out too detailed to write, sir — fewer or simpler pieces.");
    }
  }

  const box = bounds(triangles);
  // Sit it on the bed. A slicer will do this anyway, but doing it here means
  // the numbers he is told and the file on disk agree about where the bottom is.
  const standing = translate(triangles, { z: -box.min.z });

  const check = isWatertight(standing);
  return {
    triangles: standing,
    sizeMm: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
    watertight: check.closed,
    boundaryEdges: check.boundaryEdges,
  };
}

/**
 * Which pieces are not touching anything else.
 *
 * Bounding boxes only, so it is a coarse check — two boxes whose corners
 * overlap but whose material does not would pass. That is the right trade:
 * this exists to catch a piece placed at completely the wrong coordinates,
 * which is the mistake that actually happens, and a false pass costs nothing
 * because the watertight check has already run.
 */
export function floating(spec: ModelSpec): number[] {
  if (spec.pieces.length < 2) return [];
  const boxes = spec.pieces.map((piece, i) => bounds(buildPiece(piece, i)));
  const touches = (a: number, b: number) => {
    const p = boxes[a];
    const q = boxes[b];
    const gap = 1e-6;
    return (
      p.min.x <= q.max.x + gap &&
      q.min.x <= p.max.x + gap &&
      p.min.y <= q.max.y + gap &&
      q.min.y <= p.max.y + gap &&
      p.min.z <= q.max.z + gap &&
      q.min.z <= p.max.z + gap
    );
  };

  // Anything not reachable from the first piece is adrift from the body of the
  // model, which is what actually matters — not whether it touches its neighbour.
  const reached = new Set<number>([0]);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < boxes.length; i++) {
      if (reached.has(i)) continue;
      if ([...reached].some((j) => touches(i, j))) {
        reached.add(i);
        grew = true;
      }
    }
  }
  return spec.pieces.map((_, i) => i).filter((i) => !reached.has(i));
}

export interface WrittenModel {
  path: string;
  filename: string;
  folder: string;
  sizeMm: [number, number, number];
  triangles: number;
  watertight: boolean;
  /** Pieces placed where nothing else touches them. They print as loose bits. */
  floatingPieces: number[];
}

/** Build it and write it out, into the same Models folder the bracket uses. */
export function writeModel(spec: ModelSpec): WrittenModel & { built: BuiltModel } {
  const built = buildModel(spec);
  const folder = path.join(outputFolder(), "Models");
  fs.mkdirSync(folder, { recursive: true });

  const target = uniquePath(folder, safeFilename((spec.name || "model").slice(0, 60), "stl"));
  fs.writeFileSync(target, toStl(built.triangles, `Axis — ${spec.name}`));

  return {
    built,
    path: target,
    filename: path.basename(target),
    folder,
    sizeMm: built.sizeMm,
    triangles: built.triangles.length,
    watertight: built.watertight,
    floatingPieces: floating(spec),
  };
}
