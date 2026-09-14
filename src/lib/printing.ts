import type { Material } from "./loadCalc";

// How a printed part is oriented on the bed, and why it changes the answer
// more than the material does.
//
// A 3D printed part is not one solid thing. It is a stack of welded layers,
// and the weld between two layers is the weakest plane in it — typically HALF
// the strength of the plastic itself. So the same bracket, in the same
// material, at the same infill, holds roughly twice as much printed one way up
// as the other.
//
// This is the single biggest error in any printed-part calculation that
// ignores it, and it errs in the dangerous direction: a part printed the wrong
// way up and calculated as though it were solid plastic looks like it has a
// safety factor of two when it really has one. That is why this exists.
//
// The question that decides it is not "which way did it go on the bed" but
// "does the pulling stress run ALONG the layer lines, or ACROSS them".

/** Which way the tension runs relative to the welds between layers. */
export type LayerDirection = "along" | "across" | "mixed";

/**
 * How the part sat on the bed, described the way a person would.
 *
 * For a part that reaches out and carries a load at the end — a bracket, a
 * hook, an arm — these are the three ways anyone prints it:
 *
 *  - `flat`: lying down, the whole length on the bed. Layers stack upwards,
 *    across the direction the part bends. The bending tension pulls the layers
 *    apart. Weak, and the most common way to print it.
 *  - `on-edge`: stood on its narrow side, length still along the bed. Layers
 *    now run in the plane the part bends in, so the tension runs along them.
 *    Strong, usually needs no supports, and is nearly always the right answer.
 *  - `upright`: standing on end, the arm pointing up. Every layer is a
 *    cross-section of the arm and the load tries to peel them apart one at a
 *    time. Weakest by a long way; avoid for anything structural.
 */
export type PrintOrientation = "flat" | "on-edge" | "upright" | "unknown";

export function directionFor(orientation: PrintOrientation): LayerDirection {
  if (orientation === "on-edge") return "along";
  if (orientation === "flat" || orientation === "upright") return "across";
  return "mixed";
}

/**
 * What fraction of the along-layer strength survives across the weld.
 *
 * Conservative ends of the published ranges. These vary with nozzle
 * temperature, cooling and layer height more than anyone would like, which is
 * itself a reason to take the low end: a number that is right for a good print
 * and wrong for an ordinary one is not a safe number to design to.
 */
const LAYER_BOND: Record<string, number> = {
  pla: 0.45,
  petg: 0.5,
  abs: 0.4,
  asa: 0.42,
  nylon: 0.55,
  // An elastomer's layers bond nearly as well as it holds together anyway.
  tpu: 0.75,
  polycarbonate: 0.5,
  pc: 0.5,
};

export function layerBondFactor(material: Material): number {
  const key = material.name.toLowerCase().split(/[\s-]/)[0];
  return LAYER_BOND[key] ?? 0.5;
}

export interface OrientationAdvice {
  orientation: PrintOrientation;
  direction: LayerDirection;
  /** Multiplier on the material's strength for this orientation. */
  factor: number;
  /** The best orientation available, and what it would be worth. */
  best: PrintOrientation;
  bestFactor: number;
  /** How much stronger the best one is, as a multiple. */
  improvement: number;
  advice: string;
}

/**
 * What this orientation costs, and what the best one would give.
 *
 * `upright` is treated as worse than `flat` even though both pull across the
 * layers, because in an upright cantilever EVERY layer boundary sits square
 * across the arm at the point of highest stress, whereas lying flat at least
 * puts some material in the plane of the bend.
 */
export function orientationAdvice(
  material: Material,
  orientation: PrintOrientation
): OrientationAdvice {
  if (!material.printed) {
    return {
      orientation: "unknown",
      direction: "mixed",
      factor: 1,
      best: "unknown",
      bestFactor: 1,
      improvement: 1,
      advice: `${material.name} isn't printed, so there are no layers to worry about.`,
    };
  }

  const bond = layerBondFactor(material);
  const factors: Record<PrintOrientation, number> = {
    "on-edge": 1,
    flat: bond,
    // The worst case, and worth separating from flat rather than averaging in.
    upright: bond * 0.9,
    // Not told: assume the common case rather than the best one, because
    // assuming the best is how an optimistic number reaches a real shelf.
    unknown: bond,
  };

  const factor = factors[orientation];
  const improvement = factor > 0 ? factors["on-edge"] / factor : 1;

  let advice: string;
  if (orientation === "on-edge") {
    advice = "Printed on edge, the bending stress runs along the layers. That is the strong way and there is nothing to gain here.";
  } else if (orientation === "unknown") {
    advice =
      `I don't know how it will be printed, so I have assumed the common way — lying flat — which is the weak one. ` +
      `Printed on edge instead it is about ${improvement.toFixed(1)}× stronger, for no extra material.`;
  } else if (orientation === "upright") {
    advice =
      `Standing upright is the worst orientation for this: every layer joint lies square across the arm where the stress is highest. ` +
      `On edge it is roughly ${improvement.toFixed(1)}× stronger.`;
  } else {
    advice =
      `Lying flat, the bend pulls the layers apart rather than pulling along them. ` +
      `Turning it on edge is about ${improvement.toFixed(1)}× stronger and costs nothing but a different orientation in the slicer.`;
  }

  return {
    orientation,
    direction: directionFor(orientation),
    factor,
    best: "on-edge",
    bestFactor: factors["on-edge"],
    improvement,
    advice,
  };
}

/**
 * The infill part of the derating, separated from the layer part.
 *
 * loadCalc's printDerating folds a fixed 0.6 layer allowance into the same
 * number as the infill scaling, which is right for a part whose orientation
 * nobody knows. Once the orientation IS known, the layer allowance should come
 * from the orientation instead — otherwise the penalty is charged twice, and a
 * part printed the strong way is reported as weaker than it is.
 */
export function infillFactor(infillPercent: number): number {
  const infill = Math.max(0, Math.min(100, infillPercent)) / 100;
  // Bending is carried mostly by the perimeters, so this falls more slowly
  // than the infill number itself.
  return 0.45 + 0.55 * infill;
}
