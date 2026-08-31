import { anticlockwise, extrude, type Point, type Triangle, type Vec3 } from "./mesh";

// The shapes everything else is made of.
//
// There is no boolean subtraction in here, and that is a deliberate choice
// rather than a missing feature. Cutting one arbitrary mesh out of another is
// the single most failure-prone thing in solid modelling: it is where "opens
// fine, looks fine, will not slice" comes from, and getting it right needs
// exact arithmetic and a great deal of code. So instead the shapes are built
// closed from the start, and the two ways of getting a hole are built in —
// extruding a profile that already has holes in it, and revolving one.
//
// What that leaves is a small language: box, cylinder, tube, cone, sphere,
// wedge, prism, torus, an extruded outline, and a revolved one. Between them
// they cover the great majority of things anyone actually wants printed, and
// every one of them comes out watertight because it is generated rather than
// carved.
//
// Convention, and it is worth stating once: every solid is built centred on
// the origin, in all three axes. A cylinder's axis is Z. That way "put it at
// (0, 0, 20)" means the middle of the piece goes there, which is the only
// convention that stays predictable once things are being rotated.

/** Degrees, because that is what anyone describing a part will say. */
const RADIANS = Math.PI / 180;

// --- transforms -------------------------------------------------------------

function apply(triangles: Triangle[], move: (p: Vec3) => Vec3, mirrored = false): Triangle[] {
  // A mirroring transform turns the surface inside out, so the winding has to
  // come back with it or every normal points the wrong way.
  return triangles.map((t) =>
    mirrored
      ? { a: move(t.a), b: move(t.c), c: move(t.b) }
      : { a: move(t.a), b: move(t.b), c: move(t.c) }
  );
}

export function rotateX(triangles: Triangle[], degrees: number): Triangle[] {
  const s = Math.sin(degrees * RADIANS);
  const c = Math.cos(degrees * RADIANS);
  return apply(triangles, (p) => ({ x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }));
}

export function rotateY(triangles: Triangle[], degrees: number): Triangle[] {
  const s = Math.sin(degrees * RADIANS);
  const c = Math.cos(degrees * RADIANS);
  return apply(triangles, (p) => ({ x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }));
}

export function rotateZ(triangles: Triangle[], degrees: number): Triangle[] {
  const s = Math.sin(degrees * RADIANS);
  const c = Math.cos(degrees * RADIANS);
  return apply(triangles, (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }));
}

/** Stretch a solid. A negative factor mirrors it, which is why the winding is watched. */
export function scale(triangles: Triangle[], by: Partial<Vec3>): Triangle[] {
  const sx = by.x ?? 1;
  const sy = by.y ?? 1;
  const sz = by.z ?? 1;
  const flips = [sx, sy, sz].filter((v) => v < 0).length;
  return apply(
    triangles,
    (p) => ({ x: p.x * sx, y: p.y * sy, z: p.z * sz }),
    flips % 2 === 1
  );
}

// --- the primitives ---------------------------------------------------------

/** A rectangular block, centred on the origin. */
export function box(width: number, depth: number, height: number): Triangle[] {
  const x = width / 2;
  const y = depth / 2;
  const z = height / 2;

  const corner = (i: number): Vec3 => ({
    x: i & 1 ? x : -x,
    y: i & 2 ? y : -y,
    z: i & 4 ? z : -z,
  });

  // Each face given as four corner indices, wound anticlockwise seen from
  // outside. Written out rather than generated: six lines that are obviously
  // right beat a loop that is nearly right.
  const faces: [number, number, number, number][] = [
    [0, 2, 3, 1], // -z, seen from below
    [4, 5, 7, 6], // +z
    [0, 1, 5, 4], // -y
    [2, 6, 7, 3], // +y
    [0, 4, 6, 2], // -x
    [1, 3, 7, 5], // +x
  ];

  const triangles: Triangle[] = [];
  for (const [a, b, c, d] of faces) {
    triangles.push({ a: corner(a), b: corner(b), c: corner(c) });
    triangles.push({ a: corner(a), b: corner(c), c: corner(d) });
  }
  return triangles;
}

/**
 * A ring of points at a radius, in the XY plane.
 *
 * Shared by everything round so that a cylinder and the tube that fits it
 * agree on where the facets fall.
 */
function ring(radius: number, segments: number, z: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z });
  }
  return points;
}

/** Skin between two rings of equal length, outward-facing. */
function skin(lower: Vec3[], upper: Vec3[]): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 0; i < lower.length; i++) {
    const j = (i + 1) % lower.length;
    triangles.push({ a: lower[i], b: lower[j], c: upper[j] });
    triangles.push({ a: lower[i], b: upper[j], c: upper[i] });
  }
  return triangles;
}

/** Close a ring onto its own centre. Facing is set by the caller's ordering. */
function fan(points: Vec3[], centre: Vec3, up: boolean): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    triangles.push(
      up
        ? { a: centre, b: points[i], c: points[j] }
        : { a: centre, b: points[j], c: points[i] }
    );
  }
  return triangles;
}

/** A cylinder standing on the Z axis, centred on the origin. */
export function cylinder(radius: number, height: number, segments = 48): Triangle[] {
  const z = height / 2;
  const lower = ring(radius, segments, -z);
  const upper = ring(radius, segments, z);
  return [
    ...skin(lower, upper),
    ...fan(upper, { x: 0, y: 0, z }, true),
    ...fan(lower, { x: 0, y: 0, z: -z }, false),
  ];
}

/** A pipe: a cylinder with a bore up the middle. */
export function tube(
  outerRadius: number,
  innerRadius: number,
  height: number,
  segments = 48
): Triangle[] {
  if (!(innerRadius > 0)) return cylinder(outerRadius, height, segments);
  if (innerRadius >= outerRadius) {
    throw new Error("The bore has to be smaller than the tube, sir.");
  }
  const z = height / 2;
  const outerLower = ring(outerRadius, segments, -z);
  const outerUpper = ring(outerRadius, segments, z);
  const innerLower = ring(innerRadius, segments, -z);
  const innerUpper = ring(innerRadius, segments, z);

  return [
    ...skin(outerLower, outerUpper),
    // The bore faces inward, so its skin is wound the other way round.
    ...skin(innerUpper, innerLower),
    // Flat rings at each end, joining the two circles rather than closing onto
    // a centre point. Outer-to-inner at the top and inner-to-outer at the
    // bottom is what makes each of them face away from the material.
    ...skin(outerUpper, innerUpper),
    ...skin(innerLower, outerLower),
  ];
}

/**
 * A cone or a frustum: round at both ends, different radii.
 *
 * A top radius of zero gives a true cone, and the degenerate triangles that
 * would leave at the point are dropped rather than written out.
 */
export function cone(
  bottomRadius: number,
  topRadius: number,
  height: number,
  segments = 48
): Triangle[] {
  const z = height / 2;
  const triangles: Triangle[] = [];

  if (topRadius > 0 && bottomRadius > 0) {
    const lower = ring(bottomRadius, segments, -z);
    const upper = ring(topRadius, segments, z);
    triangles.push(...skin(lower, upper));
    triangles.push(...fan(upper, { x: 0, y: 0, z }, true));
    triangles.push(...fan(lower, { x: 0, y: 0, z: -z }, false));
    return triangles;
  }

  // One end is a point.
  const wide = Math.max(bottomRadius, topRadius);
  const pointUp = topRadius <= 0;
  const base = ring(wide, segments, pointUp ? -z : z);
  const apex: Vec3 = { x: 0, y: 0, z: pointUp ? z : -z };

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    triangles.push(
      pointUp
        ? { a: base[i], b: base[j], c: apex }
        : { a: base[j], b: base[i], c: apex }
    );
  }
  triangles.push(...fan(base, { x: 0, y: 0, z: pointUp ? -z : z }, !pointUp));
  return triangles;
}

/**
 * A sphere, drawn as rings of latitude.
 *
 * The rows either side of the poles collapse to triangles, which is handled by
 * fanning them rather than skinning a ring of zero radius — a zero-area
 * triangle in an STL is not fatal, but slicers complain about it and it makes
 * the watertight check harder to read.
 */
export function sphere(radius: number, segments = 32): Triangle[] {
  const rows = Math.max(3, Math.round(segments / 2));
  const triangles: Triangle[] = [];
  const rings: Vec3[][] = [];

  for (let row = 1; row < rows; row++) {
    const phi = (row / rows) * Math.PI;
    rings.push(ring(Math.sin(phi) * radius, segments, Math.cos(phi) * radius));
  }
  // Latitude runs from the north pole down, so the rings are top-first; the
  // skin wants lower-then-upper, hence the reversed pairing.
  for (let i = 0; i < rings.length - 1; i++) {
    triangles.push(...skin(rings[i + 1], rings[i]));
  }
  triangles.push(...fan(rings[0], { x: 0, y: 0, z: radius }, true));
  triangles.push(...fan(rings[rings.length - 1], { x: 0, y: 0, z: -radius }, false));
  return triangles;
}

/** A regular polygon prism: hexagonal posts, triangular columns, nuts. */
export function prism(sides: number, radius: number, height: number): Triangle[] {
  if (sides < 3) throw new Error("A prism needs at least three sides, sir.");
  return cylinder(radius, height, Math.round(sides));
}

/**
 * A doughnut, for rings, handles and hoops.
 *
 * `ringRadius` is out to the middle of the tube, `tubeRadius` is the tube
 * itself — so the hole through the middle is (ringRadius - tubeRadius) across
 * the radius.
 */
export function torus(
  ringRadius: number,
  tubeRadius: number,
  segments = 48,
  sides = 24
): Triangle[] {
  if (tubeRadius >= ringRadius) {
    throw new Error("The tube is thicker than the ring, sir — there would be no hole left.");
  }
  const loops: Vec3[][] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const loop: Vec3[] = [];
    for (let j = 0; j < sides; j++) {
      const around = (j / sides) * Math.PI * 2;
      const r = ringRadius + Math.cos(around) * tubeRadius;
      loop.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        z: Math.sin(around) * tubeRadius,
      });
    }
    loops.push(loop);
  }
  const triangles: Triangle[] = [];
  for (let i = 0; i < loops.length; i++) {
    // Next-then-current: the cross-sections wind the opposite way round the
    // tube from the way the tube travels, so pairing them the obvious way puts
    // the whole doughnut inside out.
    triangles.push(...skin(loops[(i + 1) % loops.length], loops[i]));
  }
  return triangles;
}

/**
 * A wedge: a block with one face sloped away.
 *
 * Full height at -Y, tapering to nothing at +Y. Ramps, gussets, chamfered
 * feet, doorstops.
 */
export function wedge(width: number, depth: number, height: number): Triangle[] {
  const x = width / 2;
  const y = depth / 2;
  const z = height / 2;

  // Two triangular ends in the YZ plane, joined by three faces.
  const left = [
    { x: -x, y: -y, z: -z },
    { x: -x, y: y, z: -z },
    { x: -x, y: -y, z },
  ];
  const right = left.map((p) => ({ ...p, x }));

  return [
    { a: left[0], b: left[2], c: left[1] },
    { a: right[0], b: right[1], c: right[2] },
    // Bottom.
    { a: left[0], b: left[1], c: right[1] },
    { a: left[0], b: right[1], c: right[0] },
    // Back, the tall face at -Y.
    { a: left[0], b: right[0], c: right[2] },
    { a: left[0], b: right[2], c: left[2] },
    // The slope.
    { a: left[1], b: left[2], c: right[2] },
    { a: left[1], b: right[2], c: right[1] },
  ];
}

/**
 * A flat plate with holes through it.
 *
 * The one shape where holes are free, because an outline with holes in it is
 * exactly what the extruder already takes. Built lying in XY and centred, to
 * match everything else here.
 */
export function plate(
  width: number,
  depth: number,
  thickness: number,
  holes: { x: number; y: number; diameter: number }[] = []
): Triangle[] {
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
  const bored = holes.map((hole) => {
    const points: Point[] = [];
    const segments = 24;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: width / 2 + hole.x + Math.cos(angle) * (hole.diameter / 2),
        y: depth / 2 + hole.y + Math.sin(angle) * (hole.diameter / 2),
      });
    }
    return points;
  });

  const solid = extrude({ outline, holes: bored }, thickness);
  return solid.map((t) => ({
    a: { x: t.a.x - width / 2, y: t.a.y - depth / 2, z: t.a.z - thickness / 2 },
    b: { x: t.b.x - width / 2, y: t.b.y - depth / 2, z: t.b.z - thickness / 2 },
    c: { x: t.c.x - width / 2, y: t.c.y - depth / 2, z: t.c.z - thickness / 2 },
  }));
}

/**
 * Spin an outline around the Z axis.
 *
 * This is the other half of the answer to "no boolean subtraction", and it is
 * the more expressive half: a cup, a vase, a bottle, a knob, a wheel, a spool,
 * a dome, a washer and a lampshade are all one outline turned around an axis,
 * and every one of them comes out closed.
 *
 * The outline is a closed loop drawn in the half-plane, x being the distance
 * from the axis and y the height. Points may sit on the axis at x = 0 — the
 * quad there collapses to a triangle, and the collapsed half is dropped, which
 * is what puts a proper point on a cone or a pole on a dome.
 */
export function revolve(outline: Point[], segments = 48): Triangle[] {
  if (outline.length < 3) throw new Error("A revolved outline needs at least three points, sir.");
  if (outline.some((p) => p.x < -1e-9)) {
    throw new Error("A revolved outline can't cross its own axis, sir — every x must be positive.");
  }

  // Anticlockwise in the (radius, height) half-plane puts the material on a
  // known side, which is what makes the surface face outward.
  const loop = anticlockwise(outline);
  const at = (point: Point, step: number): Vec3 => {
    // Wrapped, so the last step lands on exactly the coordinates of the first.
    // Letting it run to a full turn instead gives sin(2*pi) = -2.4e-16, and the
    // seam ends up a hair away from where it started — a hole a printer can
    // find even though nothing looks wrong.
    const angle = ((step % segments) / segments) * Math.PI * 2;
    return { x: Math.cos(angle) * point.x, y: Math.sin(angle) * point.x, z: point.y };
  };

  const triangles: Triangle[] = [];
  for (let i = 0; i < loop.length; i++) {
    const current = loop[i];
    const next = loop[(i + 1) % loop.length];
    for (let step = 0; step < segments; step++) {
      const a = at(current, step);
      const b = at(next, step);
      const c = at(next, step + 1);
      const d = at(current, step + 1);
      // On the axis these degenerate; dropping them leaves a closed surface,
      // keeping them leaves zero-area facets that slicers grumble about.
      // Wound a-c-b rather than a-b-c: the outline runs anticlockwise in the
      // half-plane and the sweep runs anticlockwise around the axis, and the
      // two together put the surface inside out unless one of them is turned.
      if (next.x > 1e-9) triangles.push({ a, b: c, c: b });
      if (current.x > 1e-9) triangles.push({ a, b: d, c });
    }
  }
  return triangles;
}
