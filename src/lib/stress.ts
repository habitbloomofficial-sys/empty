import type { Triangle } from "./mesh";
import { bounds, sectionAt, type Axis, type SectionProperties } from "./section";
import { printDerating, type Material } from "./loadCalc";
import {
  infillFactor,
  orientationAdvice,
  type OrientationAdvice,
  type PrintOrientation,
} from "./printing";

// Loading a part until it fails, on paper.
//
// loadCalc.ts answers one question well: a rectangular bar sticking out of a
// wall, will it hold. This answers the same question about a shape nobody
// wrote a formula for — a hook, a stand, a spool holder, a handle — and it
// does it the way an engineer would if the formula ran out: by cutting the
// part into sections and checking every one of them.
//
// That is not a substitute for finite-element analysis and is not presented as
// one. It is section analysis, which is the standard method for a beam whose
// shape varies along its length, and it is honest about the two things it
// cannot see: a stress concentration at a sharp internal corner, and a load
// that does not run the way it was told the load runs. Both are named in the
// cautions rather than buried.
//
// Where it is better than the formula it replaces: it finds the weakest place
// itself. A bracket that is thick at the wall and thin two thirds of the way
// out does not fail at the wall, and no closed-form answer will ever tell you
// that.

/** Earth, and the same value loadCalc uses. */
const G = 9.81;

/**
 * How the part is being held while it is loaded.
 *
 * `bend` is a cantilever — fixed at one end, weight hanging off the other.
 * `press` is a column — stood on its base with the weight pushing down.
 * `pull` is hanging — held at the top with the weight pulling straight down.
 */
export type HoldMode = "bend" | "press" | "pull";

export interface StressRequest {
  triangles: Triangle[];
  material: Material;
  /** Kilograms it has to carry. */
  loadKg: number;
  mode?: HoldMode;
  /** For printed parts. */
  infillPercent?: number;
  /**
   * The direction the part reaches, for a bend. Worked out from the shape if
   * it is not given: the longest of its two horizontal dimensions.
   */
  axis?: Axis;
  /**
   * Multiplies the force before anything else. 2 is the usual allowance for
   * something that gets caught, swung or yanked rather than set down gently.
   */
  shockFactor?: number;
  /**
   * How it will sit on the printer bed. This changes the answer by up to a
   * factor of two — see printing.ts — so it is asked for rather than assumed,
   * and an unstated orientation is treated as the common weak one.
   */
  orientation?: PrintOrientation;
}

export interface SectionSample {
  /** Position along the axis, in millimetres from the held end. */
  at: number;
  /** How far along, 0 at the held end and 1 at the loaded end. */
  fraction: number;
  areaMm2: number;
  /** Second moment about the bending axis, mm⁴. */
  secondMoment: number;
  /** Section modulus, mm³. Zero where there is no material. */
  modulus: number;
  /** MPa at this section under the stated load. */
  stress: number;
}

export interface StressReport {
  mode: HoldMode;
  axis: Axis;
  /** How long the loaded direction is, in millimetres. */
  lengthMm: number;
  sizeMm: [number, number, number];

  volumeMm3: number;
  /** What it weighs if it is solid, in grams. */
  solidMassG: number;
  /** What it is likely to weigh as printed, in grams. Null for anything not printed. */
  printedMassG: number | null;
  centreOfMass: [number, number, number];

  /** Every section that was checked, in order — enough to draw the curve. */
  samples: SectionSample[];
  /** The one that governs. */
  weakest: SectionSample;

  forceN: number;
  allowableMPa: number;
  safetyFactor: number;
  deflectionMm: number | null;

  /** Kilograms it carries with a factor of 3 in hand. */
  holdsKg: number;
  /** Kilograms at which the margin is down to 1.5 and it stops being sensible. */
  marginalKg: number;
  /** Kilograms at which the material reaches its limit. */
  breaksKg: number;

  /** Slender columns buckle long before they crush. Only set for `press`. */
  buckling: { criticalN: number; criticalKg: number; slender: boolean } | null;

  /** What the print orientation costs, for a printed part. */
  orientation: OrientationAdvice | null;
  /**
   * Shear at the held end. A short, deep part fails by tearing across the root
   * rather than by bending, and a bending-only check calls that part safe.
   */
  shear: { stressMPa: number; allowableMPa: number; governs: boolean } | null;
  /**
   * Where the cross-section changes abruptly. A step concentrates stress far
   * above the average, and section analysis cannot see it — so it is found
   * geometrically and reported as a multiplier to respect, not applied
   * silently.
   */
  concentration: { atMm: number; ratio: number; factor: number } | null;

  holds: boolean;
  headline: string;
  reasoning: string[];
  cautions: string[];
}

/** Signed volume by the divergence theorem. Negative means the solid is inside out. */
export function volumeOf(triangles: Triangle[]): number {
  let total = 0;
  for (const t of triangles) {
    total +=
      (t.a.x * (t.b.y * t.c.z - t.b.z * t.c.y) -
        t.a.y * (t.b.x * t.c.z - t.b.z * t.c.x) +
        t.a.z * (t.b.x * t.c.y - t.b.y * t.c.x)) /
      6;
  }
  return total;
}

/**
 * Where the part balances, assuming it is the same all the way through.
 *
 * Each triangle contributes a tetrahedron back to the origin; the centroid of
 * one of those is the average of its four corners, and the origin contributes
 * nothing, so it is the average of the three.
 */
export function centreOfMass(triangles: Triangle[]): [number, number, number] {
  let volume = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const t of triangles) {
    const v =
      (t.a.x * (t.b.y * t.c.z - t.b.z * t.c.y) -
        t.a.y * (t.b.x * t.c.z - t.b.z * t.c.x) +
        t.a.z * (t.b.x * t.c.y - t.b.y * t.c.x)) /
      6;
    volume += v;
    cx += (v * (t.a.x + t.b.x + t.c.x)) / 4;
    cy += (v * (t.a.y + t.b.y + t.c.y)) / 4;
    cz += (v * (t.a.z + t.b.z + t.c.z)) / 4;
  }
  if (Math.abs(volume) < 1e-9) return [0, 0, 0];
  return [cx / volume, cy / volume, cz / volume];
}

function span(triangles: Triangle[], axis: Axis): { low: number; high: number } {
  const b = bounds(triangles);
  return { low: b.min[axis], high: b.max[axis] };
}

/**
 * Which way the part reaches.
 *
 * Z is up by convention, so a cantilever reaches along whichever of X and Y is
 * longer. A part that is taller than it is wide is far more likely to be
 * something stood up than something stuck out of a wall, which is why the mode
 * is guessed the same way.
 */
export function longAxis(triangles: Triangle[]): Axis {
  const b = bounds(triangles);
  return b.max.x - b.min.x >= b.max.y - b.min.y ? "x" : "y";
}

export function guessMode(triangles: Triangle[]): HoldMode {
  const b = bounds(triangles);
  const height = b.max.z - b.min.z;
  const reach = Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
  return height > reach * 1.2 ? "press" : "bend";
}

// How finely the part is cut up, and how finely each cut is measured. Sixty
// sections is enough to land the weak point within a couple of percent of its
// real position on anything the shape language can build, and cheap enough to
// run while he is still talking.
const SAMPLES = 60;
const SCAN_ROWS = 320;

// Which end is held: for a bend the fixed end is the low end of the axis and
// the weight hangs off the high end — the bracket convention, wall at the
// origin. For a column the load arrives at the top.

function sampleSections(
  triangles: Triangle[],
  axis: Axis,
  count = SAMPLES
): { at: number; fraction: number; properties: SectionProperties }[] {
  const { low, high } = span(triangles, axis);
  const length = high - low;
  const out: { at: number; fraction: number; properties: SectionProperties }[] = [];
  if (!(length > 0)) return out;

  // Endpoints included, because on a cantilever the root is where the moment
  // is largest and skipping it costs the very number being asked for — but
  // nudged a hair inside, since a cut lying exactly in the plane of a flat end
  // cap finds no cross-section at all.
  const inset = Math.min(length * 1e-4, 1e-3);
  for (let i = 0; i < count; i++) {
    const fraction = i / (count - 1);
    const at = Math.min(high - inset, Math.max(low + inset, low + fraction * length));
    out.push({ at, fraction, properties: sectionAt(triangles, axis, at, SCAN_ROWS) });
  }
  return out;
}

/**
 * Drop the vanishing ends.
 *
 * A wedge tapers to a knife edge and a cone to a point. Ask what stress the
 * last slice of one carries and the honest arithmetic says "enormous", because
 * it is a point being asked to carry a load — which is true, useless, and
 * drowns out the answer that was actually wanted. Worse, it is a discretisation
 * artefact as much as a fact: move the last slice a hair and the number moves
 * by a factor of ten.
 *
 * So a run of near-nothing sections is trimmed from each END, and only from
 * the ends: the walk stops the moment the section grows again. That is what
 * keeps it safe. A genuine thin neck in the middle of a part is exactly the
 * thing this whole file exists to find, and it is never touched — only a taper
 * running off the end of the model is, and the caller is told it happened.
 */
function trimTips<T extends { properties: SectionProperties }>(
  sections: T[]
): { kept: T[]; trimmed: number } {
  const largest = Math.max(...sections.map((s) => s.properties.area));
  const negligible = largest * 0.01;

  let first = 0;
  while (first < sections.length && sections[first].properties.area < negligible) first++;
  let last = sections.length - 1;
  while (last > first && sections[last].properties.area < negligible) last--;

  return { kept: sections.slice(first, last + 1), trimmed: sections.length - (last + 1 - first) };
}

/**
 * Load it, and see.
 *
 * Bending is the interesting case and the one this exists for. The moment at a
 * section is the force times how far that section is from the load, and the
 * section resists it with I/c — its second moment divided by how far the
 * furthest material sits from the middle. Both of those are measured off the
 * real shape rather than assumed, so the answer is about the part that was
 * actually made and not about a rectangle standing in for it.
 */
export function stressTest(request: StressRequest): StressReport {
  const { triangles, material } = request;
  if (triangles.length === 0) throw new Error("There's no model to test, sir.");
  if (!(request.loadKg > 0)) throw new Error("How much should it carry, sir?");

  const mode = request.mode ?? guessMode(triangles);
  const axis: Axis = mode === "bend" ? (request.axis ?? longAxis(triangles)) : "z";
  const shock = Math.max(1, request.shockFactor ?? 1);
  const forceN = request.loadKg * G * shock;

  const b = bounds(triangles);
  const sizeMm: [number, number, number] = [
    b.max.x - b.min.x,
    b.max.y - b.min.y,
    b.max.z - b.min.z,
  ];
  const { low, high } = span(triangles, axis);
  const lengthMm = high - low;

  const volumeMm3 = Math.abs(volumeOf(triangles));
  const solidMassG = (volumeMm3 / 1000) * material.density;
  const infillPercent = request.infillPercent ?? 40;
  // Walls, top and bottom are solid whatever the infill is set to; on a part
  // this size they are roughly a third of it. Stated rather than implied,
  // because it is an estimate and the print will differ.
  const printedMassG = material.printed
    ? solidMassG * (0.35 + 0.65 * Math.max(0, Math.min(100, infillPercent)) / 100)
    : null;

  // The layer allowance comes from the ORIENTATION when one is known, and from
  // printDerating's blanket 0.6 when it is not. Applying both would charge the
  // penalty twice and report a well-oriented part as weaker than it is.
  const orientation = material.printed
    ? orientationAdvice(material, request.orientation ?? "unknown")
    : null;
  const derate = material.printed
    ? request.orientation && request.orientation !== "unknown"
      ? orientation!.factor * infillFactor(infillPercent)
      : printDerating(infillPercent)
    : 1;
  const allowableMPa = material.strength * derate;

  const raw = sampleSections(triangles, axis);
  const present = raw.filter((s) => s.properties.area > 1e-6);
  if (present.length === 0) {
    throw new Error("I couldn't find any material to test, sir — the model appears to be empty.");
  }

  const { kept: solid, trimmed } = trimTips(present);
  if (solid.length === 0) {
    throw new Error("I couldn't find any material to test, sir — the model appears to be empty.");
  }

  const samples: SectionSample[] = solid.map(({ at, fraction, properties }) => {
    if (mode === "bend") {
      // Distance from this section to where the weight hangs.
      const lever = high - at;
      const moment = forceN * lever;
      const c = properties.extentV;
      const modulus = c > 1e-9 ? properties.iuu / c : 0;
      return {
        at: at - low,
        fraction,
        areaMm2: properties.area,
        secondMoment: properties.iuu,
        modulus,
        stress: modulus > 1e-9 ? moment / modulus : Infinity,
      };
    }
    // Pressed or pulled: the whole force goes through every section, so the
    // thinnest one is the one that decides.
    return {
      at: at - low,
      fraction,
      areaMm2: properties.area,
      secondMoment: Math.min(properties.iuu, properties.ivv),
      modulus: properties.area,
      stress: forceN / properties.area,
    };
  });

  const weakest = samples.reduce((worst, s) => (s.stress > worst.stress ? s : worst), samples[0]);
  const safetyFactor = weakest.stress > 0 ? allowableMPa / weakest.stress : Infinity;

  // Deflection by the unit-load method, integrated over the sections that were
  // measured. For a bar of constant section this reduces to F L^3 / 3EI, which
  // is what the test checks it against.
  let deflectionMm: number | null = null;
  if (mode === "bend" && solid.length > 1) {
    const step = lengthMm / (SAMPLES - 1);
    let integral = 0;
    for (let i = 0; i < solid.length; i++) {
      const { at, properties } = solid[i];
      if (properties.iuu <= 1e-9) continue;
      const lever = high - at;
      // Trapezoid: the two ends count half, everything between counts once.
      const weight = i === 0 || i === solid.length - 1 ? 0.5 : 1;
      integral += ((lever * lever) / properties.iuu) * step * weight;
    }
    deflectionMm = (forceN / material.stiffness) * integral;
  }

  // Euler buckling: a slender column folds sideways long before the material
  // is anywhere near crushed, and it is a sudden failure with no warning. K=2
  // for something fixed at its base and free at the top, which is what a stand
  // on a desk is.
  let buckling: StressReport["buckling"] = null;
  if (mode === "press") {
    const minSecondMoment = Math.min(...solid.map((s) => Math.min(s.properties.iuu, s.properties.ivv)));
    const effectiveLength = 2 * lengthMm;
    const criticalN =
      effectiveLength > 0
        ? (Math.PI ** 2 * material.stiffness * minSecondMoment) / effectiveLength ** 2
        : Infinity;
    buckling = {
      criticalN,
      criticalKg: criticalN / G,
      slender: criticalN < forceN * 3,
    };
  }

  const holds = safetyFactor >= 3 && !(buckling?.slender ?? false);
  const scaled = (factor: number) =>
    Number.isFinite(safetyFactor) ? (request.loadKg * safetyFactor) / factor : Infinity;

  const where =
    weakest.fraction < 0.2
      ? "right at the held end"
      : weakest.fraction > 0.8
        ? "out at the loaded end"
        : `${Math.round(weakest.fraction * 100)}% of the way along`;

  const reasoning: string[] = [
    `${request.loadKg} kg is ${forceN.toFixed(1)} N${shock > 1 ? ` with the ${shock}× allowance for a snatched load` : ""}.`,
  ];

  if (mode === "bend") {
    reasoning.push(
      `Held at one end and loaded at the other, over ${lengthMm.toFixed(0)} mm of reach.`,
      `I cut it into ${samples.length} sections and checked every one. The weakest is ${where}, ${weakest.at.toFixed(0)} mm from the held end: ${weakest.areaMm2.toFixed(0)} mm² of material, a section modulus of ${weakest.modulus.toFixed(0)} mm³.`,
      `That section carries ${weakest.stress.toFixed(1)} MPa.`
    );
  } else {
    reasoning.push(
      `${mode === "press" ? "Stood up with the weight pressing down" : "Hung up with the weight pulling down"}, over ${lengthMm.toFixed(0)} mm.`,
      `I cut it into ${samples.length} sections. The thinnest is ${where}, ${weakest.at.toFixed(0)} mm up: ${weakest.areaMm2.toFixed(0)} mm² of material.`,
      `That works out at ${weakest.stress.toFixed(1)} MPa of ${mode === "press" ? "compression" : "tension"}.`
    );
  }

  reasoning.push(
    material.printed
      ? `${material.name} is good for about ${material.strength} MPa, but printed at ${infillPercent}% infill I derate that to ${allowableMPa.toFixed(1)} MPa.`
      : `${material.name} is good for about ${allowableMPa.toFixed(0)} MPa.`,
    `Safety factor ${Number.isFinite(safetyFactor) ? safetyFactor.toFixed(1) : "—"}.`
  );

  if (deflectionMm !== null) {
    reasoning.push(`The loaded end drops about ${deflectionMm.toFixed(1)} mm.`);
  }
  if (buckling && Number.isFinite(buckling.criticalN)) {
    reasoning.push(
      `As a column it folds sideways at about ${buckling.criticalKg.toFixed(1)} kg, which is ${buckling.slender ? "the limit that governs here" : "well above the crushing limit, so it isn't what decides"}.`
    );
  }
  reasoning.push(
    `It's ${volumeMm3 < 1000 ? `${volumeMm3.toFixed(0)} mm³` : `${(volumeMm3 / 1000).toFixed(1)} cm³`} of material — ${printedMassG !== null ? `about ${printedMassG.toFixed(0)} g printed at ${infillPercent}% infill` : `${solidMassG.toFixed(0)} g`}.`
  );

  const cautions: string[] = [];
  if (weakest.fraction > 0.25 && mode === "bend") {
    cautions.push(
      `The weak point is not at the wall, it's ${where}. That is worth knowing: it means making the root thicker would buy you nothing, and the fix is at ${weakest.at.toFixed(0)} mm.`
    );
  }
  if (trimmed > 0) {
    cautions.push(
      `The part tapers away to nothing at ${trimmed === 1 ? "one end" : "the ends"}, so I measured the body of it rather than the last sliver — a point cannot carry a point load, and treating it as the weak spot would tell you nothing useful. If something bears directly on that tip, it needs a flat there.`
    );
  }
  // --- shear across the root ------------------------------------------------
  //
  // A short, deep bracket does not fail by bending; it tears across the held
  // end. Bending stress falls as the part gets shorter while shear does not,
  // so a bending-only check calls exactly the stubby parts safe that are not.
  // Shear strength is taken as 0.6 of tensile, the usual approximation.
  const rootArea = samples[0]?.areaMm2 ?? 0;
  const shear =
    mode === "bend" && rootArea > 1e-6
      ? (() => {
          // 1.5× the average, which is the peak for a solid section.
          const stressMPa = (1.5 * forceN) / rootArea;
          const allowable = allowableMPa * 0.6;
          return { stressMPa, allowableMPa: allowable, governs: stressMPa / allowable > 1 / safetyFactor };
        })()
      : null;

  // --- an abrupt change of section -------------------------------------------
  //
  // Section analysis averages across each cut, so a shoulder where the part
  // steps from thick to thin reads as two safe sections with nothing wrong
  // between them. In the real part that step is where it breaks. This finds
  // the sharpest step and reports the multiplier to respect rather than
  // applying it silently — the true figure depends on the fillet radius, which
  // the mesh does not reliably tell us.
  const concentration = (() => {
    let worst: { atMm: number; ratio: number } | null = null;
    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1].areaMm2;
      const after = samples[i].areaMm2;
      if (before < 1e-6 || after < 1e-6) continue;
      const ratio = before / after;
      if (ratio > 1.35 && (!worst || ratio > worst.ratio)) {
        worst = { atMm: samples[i].at, ratio };
      }
    }
    if (!worst) return null;
    // Kt for a shouldered bar with a small fillet: roughly 1.5 to 2.5 over the
    // range that matters. Scaled with the step and capped, because beyond that
    // the number is guesswork.
    const factor = Math.min(2.5, 1 + (worst.ratio - 1) * 0.6);
    return { atMm: worst.atMm, ratio: worst.ratio, factor };
  })();

  if (shear?.governs) {
    cautions.push(
      `Shear governs, not bending: the root carries ${shear.stressMPa.toFixed(1)} MPa across it against ${shear.allowableMPa.toFixed(1)} allowed. Making it longer will not help; making the root thicker or deeper will.`
    );
  }
  if (concentration) {
    cautions.push(
      `The section steps by ${concentration.ratio.toFixed(1)}× at ${concentration.atMm.toFixed(0)} mm from the held end. A sharp shoulder there multiplies the local stress by roughly ${concentration.factor.toFixed(1)}, which this figure does not include — put a generous fillet on it.`
    );
  }
  cautions.push(
    "Section analysis, not simulation. It finds the weakest cross-section and loads it properly, but it cannot see a stress concentration at a sharp internal corner — round off inside corners and they largely go away."
  );
  if (orientation) {
    cautions.push(orientation.advice);
  }
  if (material.brittle) {
    cautions.push(`${material.name} is brittle — it gives no warning before it goes.`);
  }
  if (shock === 1) {
    cautions.push(
      "This assumes the load is set down gently and left. Ask me again with a shock factor of 2 if it will be caught, swung or yanked."
    );
  }
  if (buckling?.slender) {
    cautions.push(
      "It buckles before it crushes, and buckling is sudden. Widen the base or shorten it — thickness helps far less than width does here."
    );
  }

  const headline = !Number.isFinite(safetyFactor)
    ? "There is no meaningful load path in this model, sir — I can't test it as it stands."
    : buckling?.slender
      ? `No — it buckles at about ${buckling!.criticalKg.toFixed(1)} kg, well before the material gives. Wider or shorter.`
      : holds
        ? `Yes — safety factor ${safetyFactor.toFixed(1)}. Comfortable to about ${scaled(3).toFixed(1)} kg, and the material gives at roughly ${scaled(1).toFixed(1)} kg.`
        : safetyFactor >= 1.5
          ? `Marginal — safety factor ${safetyFactor.toFixed(1)}. It would probably hold ${request.loadKg} kg, but I'd only trust it to ${scaled(3).toFixed(1)} kg unattended. It gives at roughly ${scaled(1).toFixed(1)} kg.`
          : `No — safety factor ${safetyFactor.toFixed(1)}. It gives at about ${scaled(1).toFixed(1)} kg, which is too close to what you're asking of it.`;

  return {
    mode,
    axis,
    lengthMm,
    sizeMm,
    volumeMm3,
    solidMassG,
    printedMassG,
    centreOfMass: centreOfMass(triangles),
    samples,
    weakest,
    orientation,
    shear,
    concentration,
    forceN,
    allowableMPa,
    safetyFactor,
    deflectionMm,
    holdsKg: scaled(3),
    marginalKg: scaled(1.5),
    breaksKg: scaled(1),
    buckling,
    holds,
    headline,
    reasoning,
    cautions,
  };
}
