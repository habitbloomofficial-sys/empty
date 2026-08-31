// Making a solid, and writing it out as something a printer will accept.
//
// An STL is nothing but a bag of triangles, which means it is very easy to
// write one that opens fine, looks fine, and will not slice — because it has a
// hole in it. A printer needs a closed surface: no edge with nothing on the
// other side of it. That property is worth more than any amount of geometry
// here, so it is what the tests check.
//
// Everything is built the same way: take a flat outline, possibly with holes
// in it, and extrude it. That covers a bracket, a plate, a spacer and a shim,
// which between them are most of the things anyone actually needs printing.

export interface Point {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

/** A closed outline, plus any holes punched through it. */
export interface Profile {
  outline: Point[];
  holes?: Point[][];
}

// --- turning an outline into triangles --------------------------------------

function area(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

/** Anticlockwise, so "inside" means the same thing everywhere below. */
function anticlockwise(polygon: Point[]): Point[] {
  return area(polygon) < 0 ? [...polygon].reverse() : polygon;
}

function insideTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Ear clipping.
 *
 * The oldest trick there is: find a corner with nothing inside it, cut it off,
 * repeat. Slow for huge outlines and perfectly fine for the few dozen points a
 * bracket has.
 */
function earClip(polygon: Point[]): [Point, Point, Point][] {
  const points = anticlockwise(polygon);
  const indices = points.map((_, i) => i);
  const triangles: [Point, Point, Point][] = [];

  let guard = indices.length * indices.length + 16;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < indices.length; i++) {
      const prev = points[indices[(i - 1 + indices.length) % indices.length]];
      const current = points[indices[i]];
      const next = points[indices[(i + 1) % indices.length]];

      // Convex corner?
      const cross =
        (current.x - prev.x) * (next.y - prev.y) - (current.y - prev.y) * (next.x - prev.x);
      if (cross <= 0) continue;

      // Nothing else inside it?
      const clean = indices.every((index) => {
        const p = points[index];
        if (p === prev || p === current || p === next) return true;
        return !insideTriangle(p, prev, current, next);
      });
      if (!clean) continue;

      triangles.push([prev, current, next]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }

    // A polygon that will not clip is degenerate; take what there is rather
    // than spinning.
    if (!clipped) break;
  }

  if (indices.length === 3) {
    triangles.push([points[indices[0]], points[indices[1]], points[indices[2]]]);
  }
  return triangles;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Do two segments cross, not counting a shared endpoint? */
function crosses(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  const near = (p: Point, q: Point) =>
    Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  if (near(a1, b1) || near(a1, b2) || near(a2, b1) || near(a2, b2)) return false;

  const d1 = side(b1, b2, a1);
  const d2 = side(b1, b2, a2);
  const d3 = side(a1, a2, b1);
  const d4 = side(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function edgesOf(loop: Point[]): [Point, Point][] {
  return loop.map((point, i) => [point, loop[(i + 1) % loop.length]] as [Point, Point]);
}

/**
 * Fold each hole into the outline, so what is left is one simple loop.
 *
 * Ear clipping cannot see holes. The standard answer is to cut a channel from
 * the outline to the hole and walk around it — the outline then runs in,
 * around the hole and back out, and the channel has zero width so nothing is
 * lost.
 *
 * The channel cannot be laid anywhere, though, and this is where it goes
 * wrong: two screw holes one above the other are both nearest the same edge,
 * and the second channel then cuts straight through the first hole. The
 * outline is no longer simple, ear clipping quietly gives up part-way, and
 * what comes out is a solid with a slit in it that no slicer will print. So
 * candidates are tried nearest-first and the first one that crosses nothing is
 * taken.
 */
export function bridgeHoles(profile: Profile): Point[] {
  let outline = anticlockwise(profile.outline);
  // Holes run the other way round, so their inside is the solid's outside.
  const holes = (profile.holes ?? []).map((hole) =>
    area(hole) > 0 ? [...hole].reverse() : hole
  );

  // Rightmost first, so channels tend to run outward rather than across.
  const ordered = [...holes].sort(
    (a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x))
  );

  const remaining = new Set(ordered);

  for (const hole of ordered) {
    remaining.delete(hole);

    // Everything the channel must not cut through: the holes not yet folded
    // in, and the outline as it currently stands (which already contains the
    // channels cut for previous holes).
    const obstacles: [Point, Point][] = [
      ...[...remaining].flatMap(edgesOf),
      ...edgesOf(outline),
      ...edgesOf(hole),
    ];

    const candidates: { outer: number; inner: number; gap: number }[] = [];
    for (let i = 0; i < outline.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        candidates.push({ outer: i, inner: j, gap: distance(outline[i], hole[j]) });
      }
    }
    candidates.sort((a, b) => a.gap - b.gap);

    const clear = candidates.find((candidate) => {
      const from = outline[candidate.outer];
      const to = hole[candidate.inner];
      return !obstacles.some(([p, q]) => crosses(from, to, p, q));
    });

    // If nothing is clear the nearest is still better than giving up; a
    // slightly wrong cap is recoverable, no cap at all is not.
    const best = clear ?? candidates[0];

    // ...outline up to the bridge, round the hole, back to the bridge, on.
    const loop = [...hole.slice(best.inner), ...hole.slice(0, best.inner + 1)];
    outline = [
      ...outline.slice(0, best.outer + 1),
      ...loop,
      ...outline.slice(best.outer),
    ];
  }

  return outline;
}

/** A circle as a polygon, which is all a printer ever gets anyway. */
export function circle(centre: Point, radius: number, segments = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    });
  }
  return points;
}

/**
 * Extrude a flat profile into a solid.
 *
 * Caps top and bottom from the same triangulation, walls around every loop —
 * the outline and each hole — and the winding kept consistent so the surface
 * is closed and its outsides face out.
 */
export function extrude(profile: Profile, depth: number): Triangle[] {
  const triangles: Triangle[] = [];
  const flat = bridgeHoles(profile);
  const caps = earClip(flat);

  for (const [a, b, c] of caps) {
    // Bottom, wound so its face points down.
    triangles.push({
      a: { x: a.x, y: a.y, z: 0 },
      b: { x: c.x, y: c.y, z: 0 },
      c: { x: b.x, y: b.y, z: 0 },
    });
    // Top.
    triangles.push({
      a: { x: a.x, y: a.y, z: depth },
      b: { x: b.x, y: b.y, z: depth },
      c: { x: c.x, y: c.y, z: depth },
    });
  }

  // Walls. The outline runs anticlockwise and the holes clockwise, which is
  // exactly what makes both sets of walls face the right way with the same code.
  const loops = [anticlockwise(profile.outline), ...(profile.holes ?? []).map((hole) =>
    area(hole) > 0 ? [...hole].reverse() : hole
  )];

  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const current = loop[i];
      const next = loop[(i + 1) % loop.length];
      triangles.push({
        a: { x: current.x, y: current.y, z: 0 },
        b: { x: next.x, y: next.y, z: 0 },
        c: { x: next.x, y: next.y, z: depth },
      });
      triangles.push({
        a: { x: current.x, y: current.y, z: 0 },
        b: { x: next.x, y: next.y, z: depth },
        c: { x: current.x, y: current.y, z: depth },
      });
    }
  }

  return triangles;
}

/** Move a solid, so parts can be built where it is easy and placed where it goes. */
export function translate(triangles: Triangle[], by: Partial<Vec3>): Triangle[] {
  const dx = by.x ?? 0;
  const dy = by.y ?? 0;
  const dz = by.z ?? 0;
  const move = (p: Vec3): Vec3 => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
  return triangles.map((t) => ({ a: move(t.a), b: move(t.b), c: move(t.c) }));
}

/** Stand a solid up: what was drawn in XY becomes XZ. */
export function rotateToVertical(triangles: Triangle[]): Triangle[] {
  const turn = (p: Vec3): Vec3 => ({ x: p.x, y: p.z, z: p.y });
  // Swapping two axes mirrors the solid, so the winding is flipped back.
  return triangles.map((t) => ({ a: turn(t.a), b: turn(t.c), c: turn(t.b) }));
}

// --- writing it out ---------------------------------------------------------

function normal(t: Triangle): Vec3 {
  const u = { x: t.b.x - t.a.x, y: t.b.y - t.a.y, z: t.b.z - t.a.z };
  const v = { x: t.c.x - t.a.x, y: t.c.y - t.a.y, z: t.c.z - t.a.z };
  const n = {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
  const length = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / length, y: n.y / length, z: n.z / length };
}

/** Binary STL: smaller than the text kind, and every slicer reads it. */
export function toStl(triangles: Triangle[], title = "Axis"): Buffer {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write(title.slice(0, 79).padEnd(80, " "), 0, 80, "ascii");
  buffer.writeUInt32LE(triangles.length, 80);

  let offset = 84;
  const put = (value: number) => {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  };

  for (const triangle of triangles) {
    const n = normal(triangle);
    put(n.x); put(n.y); put(n.z);
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      put(point.x); put(point.y); put(point.z);
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buffer;
}

/**
 * Whether this really is a solid.
 *
 * The one check worth having, and it has to distinguish two things that look
 * alike in a naive count.
 *
 * An edge used ONCE is a hole in the surface. That is the fault that matters:
 * a slicer will either refuse the file or quietly fill the gap with something
 * you did not design.
 *
 * An edge used FOUR times is two closed solids touching along it. A bracket is
 * built as a plate, an arm and a gusset that overlap, because overlapping
 * bodies are far more reliable than trying to make three surfaces meet exactly
 * — and every slicer unions them. That is not a fault, and reporting it as one
 * sends you looking for a break that isn't there.
 */
export function isWatertight(triangles: Triangle[]): {
  closed: boolean;
  /** Edges with nothing on the other side. Any at all means a hole. */
  boundaryEdges: number;
  /** Edges where separate bodies touch. Expected, and harmless. */
  sharedEdges: number;
} {
  const key = (p: Vec3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
  const edges = new Map<string, number>();

  for (const t of triangles) {
    for (const [from, to] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ]) {
      // Undirected, so a shared edge matches whichever way each triangle ran.
      const ends = [key(from), key(to)].sort().join("|");
      edges.set(ends, (edges.get(ends) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let sharedEdges = 0;
  for (const count of edges.values()) {
    if (count % 2 === 1) boundaryEdges++;
    else if (count > 2) sharedEdges++;
  }
  return { closed: boundaryEdges === 0, boundaryEdges, sharedEdges };
}
