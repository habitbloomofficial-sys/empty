// Turning a flat photograph into something with real depth means guessing what
// was near and what was far. Doing that properly takes a trained depth model
// and a few hundred megabytes of weights; this does it from the picture itself.
//
// The estimate leans on three things that hold surprisingly often in ordinary
// photos: lit surfaces face the camera, the subject is nearer the middle than
// the corners, and depth changes smoothly except at edges. None of it is true
// every time — but for a hologram, a believable relief beats a flat card, and
// it runs instantly on any machine.

export interface DepthField {
  width: number;
  height: number;
  /** Depth per pixel, 0 = furthest, 1 = nearest. */
  data: Float32Array;
}

export interface HologramSource {
  color: HTMLCanvasElement;
  depth: DepthField;
}

export interface DepthOptions {
  /** Longest edge of the working image. Higher is sharper and slower. */
  maxSize?: number;
  /** Flip near and far — right for backlit shots and X-rays. */
  invert?: boolean;
  /** How strongly the centre of the frame is treated as nearer. 0 disables. */
  centreBias?: number;
  /** Blur radius, in pixels, used to keep texture from becoming relief. */
  smoothing?: number;
}

/** One pass of a separable box blur, horizontal then vertical. */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return src;

  const horizontal = new Float32Array(src.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[row + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window;
      const outgoing = src[row + Math.min(width - 1, Math.max(0, x - radius))];
      const incoming = src[row + Math.min(width - 1, Math.max(0, x + radius + 1))];
      sum += incoming - outgoing;
    }
  }

  const vertical = new Float32Array(src.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y++) {
      vertical[y * width + x] = sum / window;
      const outgoing = horizontal[Math.min(height - 1, Math.max(0, y - radius)) * width + x];
      const incoming = horizontal[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x];
      sum += incoming - outgoing;
    }
  }

  return vertical;
}

/**
 * Stretch to fill 0..1, ignoring the extreme 2% at each end. A single blown
 * highlight or black corner would otherwise squash everything else into the
 * middle of the range and flatten the relief.
 */
function normalise(values: Float32Array): void {
  const bins = new Uint32Array(256);
  for (const value of values) {
    bins[Math.min(255, Math.max(0, Math.round(value * 255)))]++;
  }

  const cutoff = values.length * 0.02;
  let low = 0;
  let high = 255;
  for (let seen = 0, i = 0; i < 256; i++) {
    seen += bins[i];
    if (seen >= cutoff) {
      low = i / 255;
      break;
    }
  }
  for (let seen = 0, i = 255; i >= 0; i--) {
    seen += bins[i];
    if (seen >= cutoff) {
      high = i / 255;
      break;
    }
  }

  const span = Math.max(high - low, 1e-3);
  for (let i = 0; i < values.length; i++) {
    values[i] = Math.min(1, Math.max(0, (values[i] - low) / span));
  }
}

export function buildHologramSource(
  image: CanvasImageSource & { width: number; height: number },
  options: DepthOptions = {}
): HologramSource {
  const { maxSize = 480, invert = false, centreBias = 0.25, smoothing = 4 } = options;

  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(2, Math.round(image.width * scale));
  const height = Math.max(2, Math.round(image.height * scale));

  const color = document.createElement("canvas");
  color.width = width;
  color.height = height;
  const ctx = color.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser wouldn't give me a canvas to work with.");
  ctx.drawImage(image, 0, 0, width, height);

  const { data: pixels } = ctx.getImageData(0, 0, width, height);
  const depth = new Float32Array(width * height);

  for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
    const r = pixels[p] / 255;
    const g = pixels[p + 1] / 255;
    const b = pixels[p + 2] / 255;

    // Perceptual luminance: the eye weights green far above blue, and using
    // a plain average makes foliage and skin read at the wrong depth.
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Saturated colour tends to belong to the subject rather than to sky or
    // wall, so let it lift the estimate a little.
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);

    depth[i] = luminance * 0.85 + saturation * 0.15;
  }

  const smoothed = boxBlur(depth, width, height, Math.round(smoothing));

  if (centreBias > 0) {
    for (let y = 0; y < height; y++) {
      const ny = (y / (height - 1)) * 2 - 1;
      for (let x = 0; x < width; x++) {
        const nx = (x / (width - 1)) * 2 - 1;
        // Smooth falloff from centre to corner, never negative.
        const radial = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2);
        smoothed[y * width + x] *= 1 - centreBias * radial * radial;
      }
    }
  }

  normalise(smoothed);

  if (invert) {
    for (let i = 0; i < smoothed.length; i++) smoothed[i] = 1 - smoothed[i];
  }

  return { color, depth: { width, height, data: smoothed } };
}
