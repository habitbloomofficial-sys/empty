import { MATERIALS, type Material } from "./loadCalc";
import { stressTest, type StressReport, type StressRequest } from "./stress";

// Not "will it hold" but "what do I change".
//
// stress.ts answers the first question well and then stops, which is the point
// at which the question actually being asked begins. A safety factor of 0.6 is
// not an answer to "will this bracket hold my hat" — it is the beginning of
// "then how thick does it need to be", and working that out by running the
// test again with different numbers until it passes is something a computer
// should do rather than a person.
//
// Every fix below is quantified and ranked by what it costs him. Turning the
// part round in the slicer is free; printing it thicker costs time and
// filament; buying aluminium costs money and a supplier. So they come back in
// that order, and the cheapest sufficient one is named as the recommendation.

/** What the part must have in hand before it is sensible to use. */
export const TARGET_SAFETY = 2;

export interface Fix {
  /** What to do, in a sentence he could act on this afternoon. */
  change: string;
  /** The safety factor it would reach. */
  reaches: number;
  /** free | cheap | costly — what it takes to do. */
  cost: "free" | "cheap" | "costly";
  /** Enough on its own? */
  sufficient: boolean;
}

export interface DesignReview {
  report: StressReport;
  /** Which failure mode actually decides it. */
  governing: "bending" | "shear" | "buckling" | "none";
  target: number;
  fixes: Fix[];
  /** The cheapest fix that gets there, if any single one does. */
  recommendation: string;
  verdict: string;
}

/**
 * Scale the thickness to reach a target safety factor.
 *
 * Bending stress goes as 1/Z, and for a section of roughly constant width Z
 * goes as thickness squared — so the thickness has to grow as the square root
 * of the improvement wanted. That is why 60% more thickness doubles the
 * strength, and why "make it a bit chunkier" is usually enough when it feels
 * like it should not be.
 */
export function thicknessFor(current: number, wanted: number, have: number): number {
  if (have <= 0) return current * 2;
  return current * Math.sqrt(wanted / have);
}

function strongerMaterials(current: Material): Material[] {
  return Object.values(MATERIALS)
    .filter((material) => material.strength > current.strength * 1.15)
    .sort((a, b) => a.strength - b.strength);
}

export interface ReviewRequest extends StressRequest {
  /** What it must have in hand. Two unless he says otherwise. */
  target?: number;
}

export function designReview(request: ReviewRequest): DesignReview {
  const target = request.target ?? TARGET_SAFETY;
  const report = stressTest(request);
  const have = report.safetyFactor;

  const governing: DesignReview["governing"] = !Number.isFinite(have)
    ? "none"
    : report.buckling?.slender
      ? "buckling"
      : report.shear?.governs
        ? "shear"
        : "bending";

  const fixes: Fix[] = [];

  // --- free: turn it round on the bed ---------------------------------------
  if (report.orientation && report.orientation.improvement > 1.05) {
    const reaches = have * report.orientation.improvement;
    fixes.push({
      change: `Print it on edge rather than ${report.orientation.orientation === "unknown" ? "flat" : report.orientation.orientation}, so the bend runs along the layers instead of prising them apart.`,
      reaches,
      cost: "free",
      sufficient: reaches >= target,
    });
  }

  // --- cheap: more material where it is thin --------------------------------
  if (Number.isFinite(have) && have > 0 && governing !== "buckling") {
    const thin = report.weakest;
    // The weakest section's depth is what the modulus actually depends on.
    const depth = thin.modulus > 0 && thin.areaMm2 > 0 ? (6 * thin.modulus) / thin.areaMm2 : 0;
    if (depth > 0) {
      const needed = thicknessFor(depth, target, have);
      fixes.push({
        change:
          `Take the weakest section — ${thin.at.toFixed(0)} mm from the held end — from about ` +
          `${depth.toFixed(1)} mm deep to ${needed.toFixed(1)} mm. Depth counts twice over: it is squared in the strength.`,
        reaches: target,
        cost: "cheap",
        sufficient: true,
      });
    }

    // Infill, but only where it is actually the limit.
    const infill = request.infillPercent ?? 40;
    if (request.material.printed && infill < 70) {
      // infillFactor is 0.45 + 0.55·f, so going to 100% is a known multiple.
      const now = 0.45 + 0.55 * (infill / 100);
      const full = 1;
      const reaches = have * (full / now);
      fixes.push({
        change: `Print it at 100% infill instead of ${infill}%.`,
        reaches,
        cost: "cheap",
        sufficient: reaches >= target,
      });
    }
  }

  // --- costly: a different material -----------------------------------------
  if (Number.isFinite(have) && have > 0) {
    for (const material of strongerMaterials(request.material)) {
      const reaches = have * (material.strength / request.material.strength);
      if (reaches < target) continue;
      fixes.push({
        change: `Make it in ${material.name} instead of ${request.material.name}. ${material.note}`,
        reaches,
        cost: material.printed ? "cheap" : "costly",
        sufficient: true,
      });
      break;
    }
  }

  // --- the thing that is specifically wrong ---------------------------------
  if (governing === "buckling") {
    fixes.unshift({
      change:
        "It buckles before it crushes, so thickness barely helps. Make it wider across, or shorter, or put a gusset on it — buckling is about slenderness, not strength.",
      reaches: Number.NaN,
      cost: "cheap",
      sufficient: false,
    });
  }
  if (governing === "shear" && report.shear) {
    fixes.unshift({
      change:
        `It tears across the root rather than bending: ${report.shear.stressMPa.toFixed(1)} MPa of shear against ${report.shear.allowableMPa.toFixed(1)} allowed. Deepen or widen where it meets the wall; length changes nothing.`,
      reaches: Number.NaN,
      cost: "cheap",
      sufficient: false,
    });
  }
  if (report.concentration) {
    fixes.push({
      change:
        `Put a fillet on the step at ${report.concentration.atMm.toFixed(0)} mm — a radius of a few millimetres there is worth about ${report.concentration.factor.toFixed(1)}× on its own, and costs nothing.`,
      reaches: Number.NaN,
      cost: "free",
      sufficient: false,
    });
  }

  const order = { free: 0, cheap: 1, costly: 2 } as const;
  fixes.sort((a, b) => order[a.cost] - order[b.cost]);

  const cheapestEnough = fixes.find((fix) => fix.sufficient);
  const recommendation = !Number.isFinite(have)
    ? "There is no load path here to review, sir."
    : have >= target
      ? `Nothing needs changing — it already has a factor of ${have.toFixed(1)} in hand.`
      : cheapestEnough
        ? cheapestEnough.change
        : "No single change gets it there; it wants two of the above together.";

  const verdict =
    have >= target
      ? `Sound as it stands: ${have.toFixed(1)} against a target of ${target}.`
      : `${have.toFixed(1)} against a target of ${target} — ${governing} is what decides it.`;

  return { report, governing, target, fixes, recommendation, verdict };
}
