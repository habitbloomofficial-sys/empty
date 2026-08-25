import type { ToneKey } from "@/lib/shop/catalog";

/*
 * Every gradient the product illustrations use, defined once.
 *
 * Thirty products on screen at once, each with its own <defs>, is thirty
 * duplicated gradient stacks in the DOM. Instead the shop shell mounts this
 * sprite once and the illustrations reference it by id.
 */

export interface Paint {
  /** Deepest shade — shadow sides, outlines. */
  d: string;
  /** The product's own colour. */
  m: string;
  /** Lit face. */
  l: string;
  /** Near-white, for glass, paper and highlights. */
  t: string;
}

export const TONES: Record<ToneKey, Paint> = {
  sand: { d: "#7d5f3c", m: "#b78f5f", l: "#dfc7a3", t: "#f4ead9" },
  clay: { d: "#7c4132", m: "#b96a50", l: "#e0b09b", t: "#f6e4da" },
  sage: { d: "#41533f", m: "#748b6f", l: "#bccdb6", t: "#e7eee3" },
  slate: { d: "#333d4a", m: "#647385", l: "#b3c0ce", t: "#e5eaf0" },
  ink: { d: "#15181e", m: "#333944", l: "#8b929d", t: "#e3e5ea" },
  plum: { d: "#432a44", m: "#7a5180", l: "#c1a0c4", t: "#eee1ef" },
  ocean: { d: "#194352", m: "#387890", l: "#a2c9d6", t: "#dfeef4" },
  brass: { d: "#6f5119", m: "#ad8834", l: "#e0c886", t: "#f5eed9" },
};

const KEYS = Object.keys(TONES) as ToneKey[];

export function ArtDefs() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {KEYS.map((key) => {
          const p = TONES[key];
          return (
            <g key={key}>
              <linearGradient id={`pa-${key}-body`} x1="0" y1="0" x2="0.7" y2="1">
                <stop offset="0%" stopColor={p.l} />
                <stop offset="55%" stopColor={p.m} />
                <stop offset="100%" stopColor={p.d} />
              </linearGradient>
              <linearGradient id={`pa-${key}-side`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={p.m} />
                <stop offset="100%" stopColor={p.d} />
              </linearGradient>
              <linearGradient id={`pa-${key}-tint`} x1="0" y1="0" x2="0.6" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor={p.t} />
              </linearGradient>
              <radialGradient id={`pa-${key}-halo`} cx="50%" cy="42%" r="58%">
                <stop offset="0%" stopColor={p.t} stopOpacity="0.85" />
                <stop offset="100%" stopColor={p.t} stopOpacity="0" />
              </radialGradient>
            </g>
          );
        })}

        <radialGradient id="pa-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2a2118" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#2a2118" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pa-sheen" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pa-steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8d97a3" />
          <stop offset="22%" stopColor="#eef1f5" />
          <stop offset="52%" stopColor="#a8b2be" />
          <stop offset="78%" stopColor="#e3e8ee" />
          <stop offset="100%" stopColor="#7c8794" />
        </linearGradient>
        <linearGradient id="pa-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3dda0" />
          <stop offset="38%" stopColor="#d4af37" />
          <stop offset="62%" stopColor="#b8860b" />
          <stop offset="100%" stopColor="#8a6410" />
        </linearGradient>
      </defs>
    </svg>
  );
}
