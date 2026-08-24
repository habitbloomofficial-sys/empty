// The shape of the core, worked out in numbers before anything is drawn.
//
// What is being built is a sphere made of light rather than surface: a hot ring
// at the centre, spokes flung out from it, a shell of fine filaments and circuit
// traces wrapped around the outside, and a haze of motes hanging in the space
// between. None of it is a mesh — it is tens of thousands of points and line
// ends, generated once and handed to the GPU as flat arrays.
//
// It lives here, apart from the component, for two reasons. The arithmetic is
// worth testing on its own — a stray radius or a NaN produces a sphere with a
// spike through it, or nothing at all, and neither is obvious from reading the
// code. And it is generated from a fixed seed, so the core looks the same every
// time Axis opens rather than being a different tangle on every reload.

/** A small, fast, deterministic generator. Same seed, same core, every time. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LineData {
  /** Pairs of endpoints: 6 numbers per segment. */
  positions: Float32Array;
  /** One rgb per vertex, so a filament can fade along its length. */
  colors: Float32Array;
}

export interface PointData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}

/** A point on a sphere of the given radius, from two angles. */
function onSphere(radius: number, theta: number, phi: number): [number, number, number] {
  const sinPhi = Math.sin(phi);
  return [
    radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  ];
}

/** Evenly spread directions, rather than the clumps pure randomness gives. */
function fibonacciPoint(index: number, total: number): [number, number] {
  const phi = Math.acos(1 - (2 * (index + 0.5)) / total);
  const theta = Math.PI * (1 + Math.sqrt(5)) * (index + 0.5);
  return [theta, phi];
}

interface Palette {
  /** Deep amber, for the far side and the quiet filaments. */
  dim: [number, number, number];
  /** The working colour of most of it. */
  mid: [number, number, number];
  /** White-hot, for the core and the few bright strands. */
  hot: [number, number, number];
}

export const AMBER: Palette = {
  dim: [0.55, 0.22, 0.03],
  mid: [1.0, 0.55, 0.08],
  hot: [1.0, 0.88, 0.55],
};

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The spokes: straight runs of light from the core out to the shell.
 *
 * Each is drawn as a chain of short segments rather than one long line, because
 * the brightness has to fall off along its length — blinding where it leaves
 * the core, almost gone by the time it reaches the outside. A single segment
 * can only fade between its two ends, which reads as a gradient rather than as
 * light thrown from a source.
 */
export function radialSpokes(
  count: number,
  { innerRadius = 0.16, outerRadius = 1, steps = 7, seed = 1 } = {}
): LineData {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * steps * 6);
  const colors = new Float32Array(count * steps * 6);

  let p = 0;
  let c = 0;

  for (let i = 0; i < count; i++) {
    const [theta, phi] = fibonacciPoint(i, count);
    // A few carry far more light than the rest, which is what stops the
    // spokes reading as a bicycle wheel.
    const bright = random() < 0.18;
    const reach = outerRadius * (0.72 + random() * 0.3);
    // A slight wander, so they are thrown rather than ruled.
    const drift = (random() - 0.5) * 0.16;

    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const r0 = innerRadius + (reach - innerRadius) * t0;
      const r1 = innerRadius + (reach - innerRadius) * t1;

      const a = onSphere(r0, theta + drift * t0, phi + drift * t0 * 0.5);
      const b = onSphere(r1, theta + drift * t1, phi + drift * t1 * 0.5);
      positions.set(a, p);
      positions.set(b, p + 3);
      p += 6;

      // Falls off with the square of the distance, as light does.
      const f0 = (1 - t0) ** 2;
      const f1 = (1 - t1) ** 2;
      const base = bright ? AMBER.hot : AMBER.mid;
      colors.set(mix(AMBER.dim, base, f0), c);
      colors.set(mix(AMBER.dim, base, f1), c + 3);
      c += 6;
    }
  }

  return { positions, colors };
}

/**
 * Great circles at every angle, forming the cage of the sphere.
 *
 * Not latitude lines: those give away where the poles are and make the thing
 * look like a globe. Rings tilted at arbitrary angles read as structure without
 * announcing an axis.
 */
export function shellRings(
  count: number,
  { radius = 1, segments = 96, seed = 2 } = {}
): LineData {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * segments * 6);
  const colors = new Float32Array(count * segments * 6);

  let p = 0;
  let c = 0;

  for (let i = 0; i < count; i++) {
    // A random orientation, as two rotations.
    const tiltX = random() * Math.PI;
    const tiltY = random() * Math.PI;
    const r = radius * (0.94 + random() * 0.1);
    const brightness = 0.25 + random() * 0.5;

    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;

      for (const [angle, offset] of [
        [a0, 0],
        [a1, 3],
      ] as const) {
        // A circle in the xy plane, then tilted twice into place.
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        const y2 = y * Math.cos(tiltX);
        const z2 = y * Math.sin(tiltX);
        positions[p + offset] = x * Math.cos(tiltY) - z2 * Math.sin(tiltY);
        positions[p + offset + 1] = y2;
        positions[p + offset + 2] = x * Math.sin(tiltY) + z2 * Math.cos(tiltY);
      }
      p += 6;

      // Dashes rather than a solid hoop: the ring flickers in and out of
      // existence around its circumference, which is what makes it look drawn
      // rather than modelled.
      const dash = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s * 0.7 + i));
      const shade = mix(AMBER.dim, AMBER.mid, brightness * dash);
      colors.set(shade, c);
      colors.set(shade, c + 3);
      c += 6;
    }
  }

  return { positions, colors };
}

/**
 * Circuit traces: the little angular runs that make it look built rather than
 * grown. Each one walks across the surface turning only at right angles, the
 * way a track on a board does.
 */
export function circuitTraces(
  count: number,
  { radius = 1, steps = 9, seed = 3 } = {}
): LineData {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * steps * 6);
  const colors = new Float32Array(count * steps * 6);

  let p = 0;
  let c = 0;

  for (let i = 0; i < count; i++) {
    let theta = random() * Math.PI * 2;
    let phi = 0.2 + random() * (Math.PI - 0.4);
    const r = radius * (0.99 + random() * 0.04);
    const scale = 0.04 + random() * 0.05;
    const brightness = 0.4 + random() * 0.6;
    // Alternates between running along one angle and the other.
    let alongTheta = random() < 0.5;

    for (let s = 0; s < steps; s++) {
      const from = onSphere(r, theta, phi);

      const run = scale * (0.5 + random());
      if (alongTheta) theta += run * (random() < 0.5 ? -1 : 1);
      else phi = Math.min(Math.PI - 0.05, Math.max(0.05, phi + run * (random() < 0.5 ? -1 : 1)));
      // Most corners turn; some carry straight on, which stops it looking
      // like a staircase.
      if (random() < 0.7) alongTheta = !alongTheta;

      const to = onSphere(r, theta, phi);
      positions.set(from, p);
      positions.set(to, p + 3);
      p += 6;

      // Traces fade out along their run, like a signal dying away.
      const fade = 1 - s / steps;
      const shade = mix(AMBER.dim, AMBER.mid, brightness * (0.35 + fade * 0.65));
      colors.set(shade, c);
      colors.set(shade, c + 3);
      c += 6;
    }
  }

  return { positions, colors };
}

/**
 * The motes: points of light hanging in and around the sphere.
 *
 * Three populations, because one is not enough to give depth. Most sit on the
 * shell. Some drift inside it. A handful are large and dim — those are the
 * out-of-focus ones, and they are what makes a flat screen look like it has a
 * lens in front of it.
 */
export function motes(count: number, { radius = 1, seed = 4 } = {}): PointData {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const roll = random();
    let r: number;
    let size: number;
    let brightness: number;

    if (roll < 0.06) {
      // Out of focus, in front of or behind everything else. Kept few and
      // pushed outwards: these are seasoning. Enough of them and the sphere is
      // behind a smeared window rather than in a room with depth.
      r = radius * (0.9 + random() * 1.0);
      size = 16 + random() * 26;
      brightness = 0.07 + random() * 0.12;
    } else if (roll < 0.4) {
      // Inside, catching the light from the core.
      r = radius * (0.18 + random() * 0.7);
      size = 2 + random() * 6;
      brightness = 0.45 + random() * 0.55;
    } else {
      // On the shell, where the filaments cross.
      r = radius * (0.95 + random() * 0.09);
      size = 1.5 + random() * 5;
      brightness = 0.3 + random() * 0.7;
    }

    const theta = random() * Math.PI * 2;
    // acos of a uniform number spreads points evenly over the sphere; using
    // the angle directly would crowd them at the poles.
    const phi = Math.acos(2 * random() - 1);
    positions.set(onSphere(r, theta, phi), i * 3);

    const heat = brightness > 0.75 ? mix(AMBER.mid, AMBER.hot, (brightness - 0.75) * 4) : AMBER.mid;
    colors.set(mix(AMBER.dim, heat, brightness), i * 3);
    sizes[i] = size;
  }

  return { positions, colors, sizes };
}

/**
 * Angular plates floating outside the sphere.
 *
 * In the reference these are the fragments hanging in the space around the
 * core — flat, hard-edged, catching the light at whatever angle they happen to
 * sit. They are what stops the whole thing reading as one circle with detail
 * inside it: something has to be *in front of* the shell and *behind* it for
 * there to be layers at all.
 *
 * Each is a wireframe triangle, drawn as three segments. Not filled — a solid
 * face would block the light behind it, and everything here is additive.
 */
export function shardPlates(
  count: number,
  { inner = 1.05, outer = 1.55, size = 0.16, seed = 5 } = {}
): LineData {
  const random = seededRandom(seed);
  // Three edges per triangle, two endpoints each.
  const positions = new Float32Array(count * 3 * 6);
  const colors = new Float32Array(count * 3 * 6);

  let p = 0;
  let c = 0;

  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const r = inner + random() * (outer - inner);
    const centre = onSphere(r, theta, phi);

    // Two directions across the plate's own plane, so the triangle is oriented
    // arbitrarily rather than all of them facing the camera.
    const spin = random() * Math.PI * 2;
    const tilt = random() * Math.PI;
    const scale = size * (0.45 + random() * 1.3);

    const corners: [number, number, number][] = [];
    for (let k = 0; k < 3; k++) {
      // A scalene triangle rather than three equal corners: equilateral ones
      // read as a deliberate pattern, and these should look like debris.
      const angle = spin + (k * Math.PI * 2) / 3 + (random() - 0.5) * 0.9;
      const reach = scale * (0.5 + random() * 0.9);
      const x = Math.cos(angle) * reach;
      const y = Math.sin(angle) * reach;
      corners.push([
        centre[0] + x * Math.cos(tilt),
        centre[1] + y,
        centre[2] + x * Math.sin(tilt),
      ]);
    }

    // Nearer plates are brighter, which is most of what tells you one is in
    // front of the shell rather than behind it.
    const near = 1 - (r - inner) / (outer - inner);
    const brightness = 0.2 + near * 0.55 + random() * 0.25;
    const shade = mix(AMBER.dim, AMBER.mid, brightness);

    for (let k = 0; k < 3; k++) {
      positions.set(corners[k], p);
      positions.set(corners[(k + 1) % 3], p + 3);
      colors.set(shade, c);
      colors.set(shade, c + 3);
      p += 6;
      c += 6;
    }
  }

  return { positions, colors };
}

/** Every number that reaches the GPU has to be one. */
export function isFinite3(array: Float32Array): boolean {
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i])) return false;
  }
  return true;
}

/** The furthest any vertex sits from the middle. */
export function maxRadius(positions: Float32Array): number {
  let most = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const d = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
    if (d > most) most = d;
  }
  return most;
}
