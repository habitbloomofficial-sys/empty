// Reading back an STL, so a model can be projected as a hologram.
//
// Binary STL: an 80-byte header nobody reads, a triangle count, then 50 bytes
// per triangle — a normal and three corners as 32-bit floats, plus two bytes
// of nothing. Simple enough that a parser is shorter than the explanation.

export interface ParsedModel {
  /** Corner coordinates, three floats per vertex, three vertices per triangle. */
  positions: Float32Array;
  triangles: number;
  /** The box it occupies, for framing it in view. */
  min: [number, number, number];
  max: [number, number, number];
}

export function parseStl(data: ArrayBuffer): ParsedModel {
  if (data.byteLength < 84) throw new Error("That file is too small to be a model.");

  const view = new DataView(data);
  const triangles = view.getUint32(80, true);

  if (data.byteLength !== 84 + triangles * 50) {
    // An ASCII STL starts with "solid" and is a different format entirely.
    throw new Error("That doesn't look like a binary STL, sir.");
  }

  const positions = new Float32Array(triangles * 9);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  let offset = 84;
  for (let t = 0; t < triangles; t++) {
    offset += 12;   // Past the normal, which three.js recomputes anyway.
    for (let corner = 0; corner < 3; corner++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = view.getFloat32(offset, true);
        offset += 4;
        positions[t * 9 + corner * 3 + axis] = value;
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    offset += 2;   // Attribute bytes, always zero in practice.
  }

  return { positions, triangles, min, max };
}

/** Centre and scale, so anything drops into the projector at a sensible size. */
export function framing(model: ParsedModel, target = 3): { centre: [number, number, number]; scale: number } {
  const centre: [number, number, number] = [
    (model.min[0] + model.max[0]) / 2,
    (model.min[1] + model.max[1]) / 2,
    (model.min[2] + model.max[2]) / 2,
  ];
  const span = Math.max(
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2]
  );
  return { centre, scale: span > 0 ? target / span : 1 };
}

/**
 * Back into triangles, so a model read off disk can be measured.
 *
 * The projector only ever needs the flat array of coordinates, but the stress
 * test works on triangles — and being able to test a file that was written
 * earlier, rather than only one being built right now, is the difference
 * between "here is a number" and "check this again for me".
 */
export function toTriangles(model: ParsedModel): {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  c: { x: number; y: number; z: number };
}[] {
  const out = [];
  for (let t = 0; t < model.triangles; t++) {
    const base = t * 9;
    const corner = (i: number) => ({
      x: model.positions[base + i * 3],
      y: model.positions[base + i * 3 + 1],
      z: model.positions[base + i * 3 + 2],
    });
    out.push({ a: corner(0), b: corner(1), c: corner(2) });
  }
  return out;
}
