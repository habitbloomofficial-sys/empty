// Will it hold?
//
// This is the part that matters, and the part where being wrong drops
// something on the floor — or on someone. So it is worked out rather than
// guessed, every assumption is stated, and the answer errs low.
//
// What it does: a cantilever bracket carrying a weight at some distance from
// the wall. That is the shelf bracket, the hook, the arm holding a hat. The
// bracket is treated as a beam built in at the wall, which is the standard
// model for one, and the two things that break it are checked: the material
// tearing at the root, and the screws pulling out of the wall.
//
// What it deliberately does not do: pretend to be finite-element analysis,
// account for shock loading, or tell anyone a bracket is safe to stand on.
// Every result carries what it assumed, and the assumptions are conservative
// on purpose — a gusset is ignored, printed plastic is derated hard, and the
// margin is quoted rather than hidden behind a yes.

/** Earth. */
const G = 9.81;

export interface Material {
  name: string;
  /** Stress it will take before it fails, MPa. Ultimate or yield, whichever governs. */
  strength: number;
  /** Young's modulus, MPa — how far it bends before it breaks. */
  stiffness: number;
  /** True for anything printed, which is weaker than the plastic it is made of. */
  printed: boolean;
  /** Brittle things give no warning before they go. */
  brittle: boolean;
  /** Grams per cubic centimetre, for working out what the part will weigh. */
  density: number;
  note: string;
}

// Conservative figures. Printed plastics are quoted at what a good print of
// them actually reaches along the layers, not at the datasheet number for the
// injection-moulded material, because those differ by more than a safety
// factor does.
export const MATERIALS: Record<string, Material> = {
  pla: {
    name: "PLA",
    strength: 45,
    stiffness: 3000,
    printed: true,
    brittle: true,
    density: 1.24,
    note: "Stiff and strong for its weight, but brittle, and it creeps and softens in a warm room or a sunny window. Fine indoors, poor in a car.",
  },
  petg: {
    name: "PETG",
    strength: 45,
    stiffness: 1900,
    printed: true,
    brittle: false,
    density: 1.27,
    note: "The sensible default for something load-bearing. Bends before it breaks, and tolerates warmth far better than PLA.",
  },
  abs: {
    name: "ABS",
    strength: 35,
    stiffness: 2000,
    printed: true,
    brittle: false,
    density: 1.04,
    note: "Tough and heat-tolerant, weaker between layers than PETG unless printed in an enclosure.",
  },
  asa: {
    name: "ASA",
    strength: 40,
    stiffness: 2000,
    printed: true,
    brittle: false,
    density: 1.07,
    note: "ABS that survives sunlight. The choice for anything outdoors.",
  },
  nylon: {
    name: "Nylon",
    strength: 45,
    stiffness: 1500,
    printed: true,
    brittle: false,
    density: 1.14,
    note: "Very tough, but it absorbs water and goes soft and floppy if it isn't kept dry.",
  },
  tpu: {
    name: "TPU",
    // Rubber, not plastic. It stretches enormously before it tears, and its
    // stiffness is a thousandth of PETG's — which is the whole point of it for
    // anything that has to flex on and off something, and which makes any
    // deflection figure for it meaningless.
    strength: 25,
    stiffness: 40,
    printed: true,
    brittle: false,
    density: 1.21,
    note: "Flexible. The right material for a phone case, a strap or a bumper — it stretches over things and grips them. Useless for anything that has to stay rigid.",
  },
  aluminium: {
    name: "Aluminium 6061-T6",
    strength: 240,
    stiffness: 69000,
    printed: false,
    brittle: false,
    density: 2.7,
    note: "Yield strength. Machined or cut from stock, not printed.",
  },
  steel: {
    name: "Mild steel",
    strength: 250,
    stiffness: 200000,
    printed: false,
    brittle: false,
    density: 7.85,
    note: "Yield strength. Bends visibly long before it breaks, which is the failure you want.",
  },
  plywood: {
    name: "Plywood",
    strength: 30,
    stiffness: 8000,
    printed: false,
    brittle: false,
    density: 0.6,
    note: "Bending strength across the face. Varies a lot with grade and moisture.",
  },
  pine: {
    name: "Pine",
    strength: 40,
    stiffness: 9000,
    printed: false,
    brittle: true,
    density: 0.5,
    note: "Along the grain. Across it, a fraction of this — and a knot at the root halves it again.",
  },
};

export const MATERIAL_NAMES = Object.keys(MATERIALS);

export function findMaterial(name: string): Material | null {
  const key = name.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (MATERIALS[key]) return MATERIALS[key];
  const found = Object.entries(MATERIALS).find(
    ([id, material]) => key.includes(id) || material.name.toLowerCase().replace(/[^a-z]/g, "").includes(key)
  );
  return found ? found[1] : null;
}

/**
 * How much of a printed part's strength actually survives the printing.
 *
 * Two things take it away. A printed part is layers glued together, and a load
 * that tries to peel them apart is held by the glue rather than the plastic —
 * so the number below is already well under the datasheet. And infill is air:
 * bending is carried mostly by the outer walls, so it does not fall away as
 * fast as the infill percentage does, but it falls.
 */
export function printDerating(infillPercent: number): number {
  const infill = Math.max(0, Math.min(100, infillPercent)) / 100;
  // 0.6 for the layer bond, then walls-dominated scaling for the infill.
  return 0.6 * (0.45 + 0.55 * infill);
}

export interface BracketLoad {
  /** What it is holding, in kilograms. */
  massKg: number;
  /** How far the weight sits from the wall, in millimetres. */
  reachMm: number;
  /** Across the bracket, in millimetres. */
  widthMm: number;
  /** How thick the arm is, in millimetres. */
  thicknessMm: number;
  material: Material;
  /** For printed parts. Ignored otherwise. */
  infillPercent?: number;
  /** Vertical distance between the top and bottom screws, in millimetres. */
  screwSpacingMm?: number;
  /** How many screws hold it to the wall. */
  screws?: number;
}

export interface Verdict {
  /** Newtons. */
  force: number;
  /** Newton-millimetres at the wall — where it breaks, if it breaks. */
  moment: number;
  /** MPa in the material at the root. */
  stress: number;
  /** MPa the material may take, after derating. */
  allowable: number;
  /** allowable / stress. Above 3 is comfortable; below 1.5 is not. */
  safetyFactor: number;
  /** How far the end droops under the load, in millimetres. */
  deflectionMm: number;
  /** Newtons of pull-out on the topmost screw, which is usually what fails. */
  screwTensionN: number;
  /** Kilograms this bracket would carry at a safety factor of 3. */
  safeLoadKg: number;
  /** The shortest honest answer. */
  holds: boolean;
  headline: string;
  reasoning: string[];
  cautions: string[];
}

/**
 * Work it out.
 *
 * Beam bending at the root, which is where a cantilever fails: the moment is
 * the weight times how far out it sits, and the section resists it with
 * b·t²/6. Deflection is the standard end-loaded cantilever. The screw tension
 * is that same moment resolved into a couple across the fixing spacing.
 */
export function assessBracket(load: BracketLoad): Verdict {
  const { massKg, reachMm, widthMm, thicknessMm, material } = load;

  const force = massKg * G;
  const moment = force * reachMm;

  // Rectangular section: modulus b·t²/6, second moment b·t³/12.
  const sectionModulus = (widthMm * thicknessMm ** 2) / 6;
  const secondMoment = (widthMm * thicknessMm ** 3) / 12;

  const stress = sectionModulus > 0 ? moment / sectionModulus : Infinity;

  const derate = material.printed ? printDerating(load.infillPercent ?? 20) : 1;
  const allowable = material.strength * derate;

  const safetyFactor = stress > 0 ? allowable / stress : Infinity;
  const deflectionMm =
    secondMoment > 0 ? (force * reachMm ** 3) / (3 * material.stiffness * secondMoment) : Infinity;

  // The moment has to be resisted by the fixings as a push at the bottom and a
  // pull at the top. The pull is what tears an anchor out of plasterboard.
  const spacing = load.screwSpacingMm ?? Math.max(30, reachMm * 0.6);
  const screws = Math.max(1, load.screws ?? 2);
  const screwTensionN = spacing > 0 ? moment / spacing / Math.max(1, Math.floor(screws / 2)) : Infinity;

  // What it would carry with a factor of three in hand.
  const safeLoadKg =
    stress > 0 && Number.isFinite(stress) ? (massKg * safetyFactor) / 3 : Infinity;

  const holds = safetyFactor >= 3;

  const reasoning = [
    `${massKg} kg is ${force.toFixed(1)} N. At ${reachMm} mm from the wall that is a bending moment of ${(moment / 1000).toFixed(1)} N·m at the root.`,
    `A ${widthMm} × ${thicknessMm} mm section has a modulus of ${sectionModulus.toFixed(0)} mm³, so the stress at the root is ${stress.toFixed(1)} MPa.`,
    material.printed
      ? `${material.name} is good for about ${material.strength} MPa, but printed at ${load.infillPercent ?? 20}% infill I derate that to ${allowable.toFixed(1)} MPa — layers are glued, not solid.`
      : `${material.name} is good for about ${allowable.toFixed(0)} MPa.`,
    `That leaves a safety factor of ${safetyFactor.toFixed(1)}.`,
    `It will droop about ${deflectionMm.toFixed(1)} mm under the load.`,
    `The top fixing has to resist about ${screwTensionN.toFixed(0)} N of pull-out — roughly ${(screwTensionN / G).toFixed(1)} kg hanging straight off it.`,
  ];

  const cautions: string[] = [];
  if (material.printed) {
    cautions.push(
      "Print it so the layers run along the arm, not across the root — a bracket printed flat on its side snaps at the first layer line. Standing it up, or laying the L flat on the bed, both work; printing it upright like a tower does not."
    );
  }
  if (material.brittle) {
    cautions.push(
      `${material.name} is brittle: it gives no warning before it goes. If this is above head height or over anything breakable, use PETG instead.`
    );
  }
  if (deflectionMm > reachMm * 0.02) {
    cautions.push(
      `${deflectionMm.toFixed(1)} mm of droop is visible. It is not a strength problem, but it will look wrong — thicker is the cure, and thickness helps far more than width.`
    );
  }
  cautions.push(
    "The bracket is usually not what fails — the wall is. That top screw needs to hold about " +
      `${(screwTensionN / G).toFixed(1)} kg of straight pull. Into a stud or masonry that is nothing; into plasterboard it needs a proper anchor rated for it, and the rating is on the packet.`
  );
  cautions.push(
    "This assumes a steady load. Something swinging, or caught and yanked, can double the force for an instant — if that is likely, halve the numbers before you decide."
  );
  cautions.push(
    "Worked from beam theory, not simulation, and the arm is treated as a plain rectangle with no gusset. A gusset makes it stronger than this says, never weaker."
  );

  const headline = holds
    ? `Yes — safety factor ${safetyFactor.toFixed(1)}, about ${deflectionMm.toFixed(1)} mm of droop. Comfortable.`
    : safetyFactor >= 1.5
      ? `Marginal — safety factor ${safetyFactor.toFixed(1)}. It would probably hold, but there is not enough in hand for something you leave alone. Thicker, or a shorter reach.`
      : `No — safety factor ${safetyFactor.toFixed(1)}. Do not rely on this. It needs to be thicker, shorter, or in a stronger material.`;

  return {
    force,
    moment,
    stress,
    allowable,
    safetyFactor,
    deflectionMm,
    screwTensionN,
    safeLoadKg,
    holds,
    headline,
    reasoning,
    cautions,
  };
}

/**
 * The thickness that would carry this comfortably.
 *
 * Solved rather than searched: stress is proportional to 1/t², so the
 * thickness for a given safety factor falls straight out. Rounded up to the
 * nearest half-millimetre, because nobody prints to three decimal places.
 */
export function thicknessFor(
  load: Omit<BracketLoad, "thicknessMm">,
  safetyFactor = 3
): number {
  const force = load.massKg * G;
  const moment = force * load.reachMm;
  const derate = load.material.printed ? printDerating(load.infillPercent ?? 20) : 1;
  const allowable = load.material.strength * derate;
  if (allowable <= 0 || load.widthMm <= 0) return Infinity;

  // σ = 6M / (b t²)  →  t = sqrt(6 M SF / (b σ))
  const exact = Math.sqrt((6 * moment * safetyFactor) / (load.widthMm * allowable));
  return Math.ceil(exact * 2) / 2;
}
