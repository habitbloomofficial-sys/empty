import type { Triangle, Vec3 } from "./mesh";

// Cutting a solid open and measuring what is left.
//
// This is the machinery the stress test stands on, and it is the reason the
// stress test works on any shape rather than only on the bracket. Slice the
// part across the direction the load runs, and the slice tells you everything
// that matters about how strong it is there: how much material there is, where
// its middle sits, and — the number that actually governs bending — how far
// that material is spread from the middle.
//
// Two things here are worth stating, because both are places where a plausible
// implementation quietly gives a wrong and dangerous answer.
//
// The first is orientation. Each cut segment is pointed using the triangle's
// own outward normal, so an outline comes out anticlockwise and a hole
// clockwise, automatically. Nothing has to guess which loop is a hole.
//
// The second is overlap, and it is the important one. Parts here are composed
// by putting solids on top of each other and letting the slicer weld them —
// which means a cut through the join finds two loops covering the same
// material. Adding their areas would count that material twice, overstate the
// section, understate the stress, and say a bracket holds when it does not.
// So the area is not summed from the loops at all: it is integrated with the
// nonzero winding rule, where overlapping material counts once no matter how
// many solids claim it. That is the difference between a number and a number
// you can hang something from.

export interface Vec2 {
  u: number;
  v: number;
}

/** One closed outline of a cut, in the plane's own two coordinates. */
export type Loop = Vec2[];

/** Which way the cut faces. */
export type Axis = "x" | "y" | "z";

export interface SectionProperties {
  /** Square millimetres of solid material. Overlaps counted once. */
  area: number;
  /** Where the middle of that material sits, in the plane's coordinates. */
  centroid: Vec2;
  /** Second moment about the horizontal axis through the centroid, mm⁴. */
  iuu: number;
  /** Second moment about the vertical axis through the centroid, mm⁴. */
  ivv: number;
  /** How far the furthest material sits from the centroid, each way. */
  extentU: number;
  extentV: number;
}

/**
 * The two in-plane directions for a cut, and which way is "up" in them.
 *
 * Fixed per axis so that a section's coordinates mean the same thing every
 * time: v is always the world axis that gravity runs along where that is
 * available, because bending under a weight is what is nearly always being
 * asked about.
 */
function planeAxes(axis: Axis): { u: keyof Vec3; v: keyof Vec3 } {
  if (axis === "x") return { u: "y", v: "z" };
  if (axis === "y") return { u: "x", v: "z" };
  return { u: "x", v: "y" };
}

function componentOf(point: Vec3, axis: Axis): number {
  return axis === "x" ? point.x : axis === "y" ? point.y : point.z;
}

function normalOf(t: Triangle): Vec3 {
  const ux = t.b.x - t.a.x;
  const uy = t.b.y - t.a.y;
  const uz = t.b.z - t.a.z;
  const vx = t.c.x - t.a.x;
  const vy = t.c.y - t.a.y;
  const vz = t.c.z - t.a.z;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function bounds(triangles: Triangle[]): Bounds {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      if (p.x < min.x) min.x = p.x;
      if (p.y < min.y) min.y = p.y;
      if (p.z < min.z) min.z = p.z;
      if (p.x > max.x) max.x = p.x;
      if (p.y > max.y) max.y = p.y;
      if (p.z > max.z) max.z = p.z;
    }
  }
  return { min, max };
}

/**
 * Cut the solid with a plane and return the outlines, oriented.
 *
 * Each triangle straddling the plane contributes one segment. The segment is
 * pointed along (cut direction × outward normal), which is what makes solid
 * material lie to its left — so outlines come back anticlockwise and holes
 * clockwise without anything having to work out which is which.
 */
export function cut(triangles: Triangle[], axis: Axis, at: number): [Vec2, Vec2][] {
  const { u, v } = planeAxes(axis);
  const segments: [Vec2, Vec2][] = [];

  for (const triangle of triangles) {
    const corners = [triangle.a, triangle.b, triangle.c];
    const heights = corners.map((p) => componentOf(p, axis) - at);

    // A triangle lying in the plane contributes nothing: its neighbours
    // already describe the boundary there, and its own segment would be a
    // duplicate that breaks the chaining.
    if (heights.every((h) => Math.abs(h) < 1e-9)) continue;

    const crossings: Vec2[] = [];
    for (let i = 0; i < 3; i++) {
      const h1 = heights[i];
      const h2 = heights[(i + 1) % 3];
      // Only edges that genuinely straddle, and a vertex exactly on the plane
      // counted once (as the start of its edge) rather than by both edges.
      if (h1 === 0) {
        crossings.push({ u: corners[i][u], v: corners[i][v] });
      } else if ((h1 < 0 && h2 > 0) || (h1 > 0 && h2 < 0)) {
        const t = h1 / (h1 - h2);
        const p1 = corners[i];
        const p2 = corners[(i + 1) % 3];
        crossings.push({
          u: p1[u] + (p2[u] - p1[u]) * t,
          v: p1[v] + (p2[v] - p1[v]) * t,
        });
      }
    }
    if (crossings.length !== 2) continue;

    const [first, second] = crossings;
    if (Math.abs(first.u - second.u) < 1e-12 && Math.abs(first.v - second.v) < 1e-12) continue;

    // Point it so that material is on the left. cutDirection × normal, taken
    // in the plane: for a cut along +z that is (-n_v, n_u) rotated, which
    // reduces to the two components below for every axis.
    const n = normalOf(triangle);
    const wanted = { u: -n[v], v: n[u] };
    const along = { u: second.u - first.u, v: second.v - first.v };
    const agrees = along.u * wanted.u + along.v * wanted.v >= 0;
    segments.push(agrees ? [first, second] : [second, first]);
  }

  return segments;
}

/**
 * Measure the material in a cut.
 *
 * Scanline integration under the nonzero winding rule. Each horizontal line
 * across the section is crossed by the outlines; walking the crossings in
 * order while adding up their directions gives the winding, and wherever the
 * winding is not zero there is material — once, however many overlapping
 * solids happen to be there.
 *
 * Exact along the line, discretised across it, which is the right way round:
 * the integrals in u are done in closed form and only v is stepped.
 */
export function measure(segments: [Vec2, Vec2][], rows = 400): SectionProperties {
  const empty: SectionProperties = {
    area: 0,
    centroid: { u: 0, v: 0 },
    iuu: 0,
    ivv: 0,
    extentU: 0,
    extentV: 0,
  };
  if (segments.length === 0) return empty;

  let minV = Infinity;
  let maxV = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  for (const [a, b] of segments) {
    for (const p of [a, b]) {
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
      if (p.u < minU) minU = p.u;
      if (p.u > maxU) maxU = p.u;
    }
  }
  const span = maxV - minV;
  if (!(span > 0)) return empty;

  const dv = span / rows;
  let area = 0;
  let sumU = 0;
  let sumV = 0;
  let sumUU = 0;
  let sumVV = 0;

  // Crossings are collected per row with the direction each segment runs, so
  // the winding number can be accumulated left to right.
  const hits: { u: number; direction: number }[] = [];

  for (let row = 0; row < rows; row++) {
    // Sample at the middle of each band: a boundary that falls exactly on a
    // sample line is the one case where a crossing is ambiguous.
    const v = minV + (row + 0.5) * dv;
    hits.length = 0;

    for (const [a, b] of segments) {
      const lower = Math.min(a.v, b.v);
      const upper = Math.max(a.v, b.v);
      if (v < lower || v >= upper) continue;
      const t = (v - a.v) / (b.v - a.v);
      hits.push({ u: a.u + (b.u - a.u) * t, direction: b.v > a.v ? 1 : -1 });
    }
    if (hits.length < 2) continue;
    hits.sort((p, q) => p.u - q.u);

    let winding = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      winding += hits[i].direction;
      if (winding === 0) continue;

      const u0 = hits[i].u;
      const u1 = hits[i + 1].u;
      const width = u1 - u0;
      if (width <= 0) continue;

      area += width * dv;
      sumU += ((u1 * u1 - u0 * u0) / 2) * dv;
      sumV += width * v * dv;
      sumUU += ((u1 ** 3 - u0 ** 3) / 3) * dv;
      sumVV += width * v * v * dv;
    }
  }

  if (!(area > 0)) return empty;

  const centroid = { u: sumU / area, v: sumV / area };
  // Parallel axis, shifting the raw second moments onto the centroid.
  const ivv = sumUU - area * centroid.u ** 2;
  const iuu = sumVV - area * centroid.v ** 2;

  return {
    area,
    centroid,
    iuu: Math.max(0, iuu),
    ivv: Math.max(0, ivv),
    extentU: Math.max(Math.abs(maxU - centroid.u), Math.abs(centroid.u - minU)),
    extentV: Math.max(Math.abs(maxV - centroid.v), Math.abs(centroid.v - minV)),
  };
}

/** Cut and measure in one go. */
export function sectionAt(
  triangles: Triangle[],
  axis: Axis,
  at: number,
  rows = 400
): SectionProperties {
  return measure(cut(triangles, axis, at), rows);
}
