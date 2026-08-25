/*
 * The scenes behind the introduction.
 *
 * Each is a full-bleed illustration built the way a photograph is composed —
 * a lit subject, a falling-off background, a vignette and a layer of grain —
 * rather than a flat icon blown up. They are drawn instead of shot for the same
 * reason the products are: there is nothing to photograph yet, and eight stock
 * images would arrive with eight different lights.
 *
 * Every id is prefixed with its scene, because the slideshow keeps all of them
 * mounted so it can cross-fade between them.
 */

// Server and client both format these coordinates into the same markup only if
// the trig is rounded; raw floats differ in their last bits and break hydration.
const round2 = (n: number) => Math.round(n * 100) / 100;

const GOLD = {
  pale: "#f6e4b0",
  light: "#e6c877",
  mid: "#c9a227",
  deep: "#8f6a12",
  dark: "#5b4309",
};

const NIGHT = { far: "#080a0e", mid: "#11141b", near: "#1b1f29" };

function Grain({ id }: { id: string }) {
  return (
    <>
      <filter id={`${id}-grain`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="800" height="500" filter={`url(#${id}-grain)`} opacity="0.09" style={{ mixBlendMode: "overlay" }} />
      <rect width="800" height="500" fill={`url(#${id}-vignette)`} />
    </>
  );
}

function SceneBase({ id, warm = 0.5 }: { id: string; warm?: number }) {
  return (
    <>
      <radialGradient id={`${id}-vignette`} cx="50%" cy="46%" r="72%">
        <stop offset="55%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.62" />
      </radialGradient>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={NIGHT.far} />
        <stop offset="60%" stopColor={NIGHT.mid} />
        <stop offset="100%" stopColor={NIGHT.near} />
      </linearGradient>
      <radialGradient id={`${id}-warm`} cx="50%" cy="42%" r="55%">
        <stop offset="0%" stopColor="#ffcf7a" stopOpacity={warm} />
        <stop offset="100%" stopColor="#ffcf7a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={GOLD.pale} />
        <stop offset="35%" stopColor={GOLD.light} />
        <stop offset="65%" stopColor={GOLD.mid} />
        <stop offset="100%" stopColor={GOLD.deep} />
      </linearGradient>
      <linearGradient id={`${id}-bar-side`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={GOLD.deep} />
        <stop offset="100%" stopColor={GOLD.dark} />
      </linearGradient>
      <linearGradient id={`${id}-bar-top`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff3d0" />
        <stop offset="100%" stopColor={GOLD.light} />
      </linearGradient>
    </>
  );
}

const stage = {
  viewBox: "0 0 800 500",
  preserveAspectRatio: "xMidYMid slice",
} as const;

// ---------------------------------------------------------------------------
// 1. The vault. Shown behind the access code, and again on the opening slide.
// ---------------------------------------------------------------------------

export function VaultScene({ className }: { className?: string }) {
  const id = "vault";
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.42} />
        <radialGradient id={`${id}-door`} cx="38%" cy="34%" r="80%">
          <stop offset="0%" stopColor="#39404d" />
          <stop offset="55%" stopColor="#232833" />
          <stop offset="100%" stopColor="#12161d" />
        </radialGradient>
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {/* Floor */}
      <path d="M0 372h800v128H0z" fill="#0c0e13" />
      <path d="M0 372h800v3H0z" fill={GOLD.deep} opacity="0.35" />
      <ellipse cx="400" cy="392" rx="230" ry="24" fill={GOLD.mid} opacity="0.09" />

      {/* Door frame */}
      <rect x="196" y="52" width="408" height="320" rx="12" fill="#171b23" />
      <rect x="208" y="64" width="384" height="296" rx="8" fill="#0e1117" />

      {/* The door itself */}
      <circle cx="400" cy="212" r="146" fill={`url(#${id}-door)`} />
      <circle cx="400" cy="212" r="146" fill="none" stroke={GOLD.deep} strokeWidth="3" opacity="0.55" />
      <circle cx="400" cy="212" r="126" fill="none" stroke="#3a414e" strokeWidth="2" />
      <circle cx="400" cy="212" r="96" fill="none" stroke="#333a46" strokeWidth="10" />
      <circle cx="400" cy="212" r="64" fill="#1b202a" />

      {/* Bolt heads around the rim */}
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={round2(400 + Math.cos(a) * 136)}
            cy={round2(212 + Math.sin(a) * 136)}
            r="4.5"
            fill={GOLD.mid}
            opacity="0.55"
          />
        );
      })}

      {/* Handle wheel */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M400 212L${round2(400 + Math.cos(a) * 58)} ${round2(212 + Math.sin(a) * 58)}`}
            stroke={`url(#${id}-bar)`}
            strokeWidth="11"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="400" cy="212" r="60" fill="none" stroke={`url(#${id}-bar)`} strokeWidth="9" />
      <circle cx="400" cy="212" r="19" fill={`url(#${id}-bar-top)`} />
      <circle cx="400" cy="212" r="9" fill={GOLD.dark} opacity="0.7" />

      {/* Light escaping the seam */}
      <path d="M546 212a146 146 0 0 1-8 47l24 9a172 172 0 0 0 9-56z" fill={GOLD.light} opacity="0.16" />
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 2. Gold and money. The margin, made literal.
// ---------------------------------------------------------------------------

function Bar({ x, y, w = 118, h = 34, id }: { x: number; y: number; w?: number; h?: number; id: string }) {
  const skew = 26;
  return (
    <g>
      {/* top face */}
      <path d={`M${x} ${y}h${w}l${skew}-15H${x + skew}z`} fill={`url(#${id}-bar-top)`} />
      {/* front face */}
      <path d={`M${x} ${y}h${w}v${h}l-6 5H${x + 6}l-6-5z`} fill={`url(#${id}-bar)`} />
      {/* right face */}
      <path d={`M${x + w} ${y}l${skew}-15v${h}l-${skew} ${h > 0 ? 15 : 0}z`} fill={`url(#${id}-bar-side)`} />
      {/* stamp */}
      <rect x={x + 26} y={y + 10} width="66" height="16" rx="3" fill={GOLD.dark} opacity="0.28" />
      <path d={`M${x + 34} ${y + 18}h50`} stroke={GOLD.pale} strokeWidth="2.4" opacity="0.6" strokeLinecap="round" />
      {/* specular */}
      <path d={`M${x + 4} ${y + 3}h${w - 8}v5H${x + 4}z`} fill="#fff8e2" opacity="0.5" />
    </g>
  );
}

function CoinStack({ x, y, count, id }: { x: number; y: number; count: number; id: string }) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const cy = y - i * 11;
        return (
          <g key={i}>
            <path d={`M${x - 36} ${cy}a36 13 0 0 0 72 0v-9a36 13 0 0 1-72 0z`} fill={`url(#${id}-bar-side)`} />
            <ellipse cx={x} cy={cy - 9} rx="36" ry="13" fill={`url(#${id}-bar)`} />
            <ellipse cx={x} cy={cy - 9} rx="26" ry="9" fill="none" stroke={GOLD.pale} strokeWidth="1.6" opacity="0.5" />
          </g>
        );
      })}
    </g>
  );
}

export function GoldScene({ className }: { className?: string }) {
  const id = "gold";
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.6} />
        <linearGradient id={`${id}-note`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor="#2f4a3d" />
          <stop offset="50%" stopColor="#456b57" />
          <stop offset="100%" stopColor="#2b4438" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {/* Light shafts from above */}
      <path d="M300 0l-90 500h70L360 0z" fill={GOLD.light} opacity="0.05" />
      <path d="M470 0l90 500h-70L410 0z" fill={GOLD.light} opacity="0.04" />

      <path d="M0 380h800v120H0z" fill="#0b0d12" />
      <ellipse cx="400" cy="390" rx="300" ry="34" fill={GOLD.mid} opacity="0.12" />

      {/* Banknote fan, laid behind the metal */}
      <g opacity="0.92">
        {[-16, -6, 4, 14].map((rot, i) => (
          <g key={i} transform={`rotate(${rot} 620 340)`}>
            <rect x={556 + i * 6} y={318 - i * 4} width="140" height="66" rx="4" fill={`url(#${id}-note)`} />
            <rect x={562 + i * 6} y={324 - i * 4} width="128" height="54" rx="2" fill="none" stroke="#8fc0a5" strokeWidth="1" opacity="0.5" />
            <circle cx={626 + i * 6} cy={351 - i * 4} r="16" fill="#8fc0a5" opacity="0.25" />
            <path d={`M${572 + i * 6} ${338 - i * 4}h22M${572 + i * 6} ${346 - i * 4}h16`} stroke="#a8d3ba" strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* Coin stacks */}
      <CoinStack x={168} y={382} count={5} id={id} />
      <CoinStack x={246} y={386} count={3} id={id} />

      {/* Bullion pyramid */}
      <Bar x={330} y={330} id={id} />
      <Bar x={456} y={330} id={id} />
      <Bar x={394} y={288} id={id} />
      <Bar x={458} y={246} w={96} h={30} id={id} />

      {/* Scattered coins on the floor */}
      {[[110, 402], [300, 408], [560, 404], [690, 398]].map(([cx, cy], i) => (
        <g key={i}>
          <ellipse cx={cx} cy={cy} rx="26" ry="9" fill={`url(#${id}-bar)`} />
          <ellipse cx={cx} cy={cy} rx="18" ry="6" fill="none" stroke={GOLD.pale} strokeWidth="1.4" opacity="0.5" />
        </g>
      ))}

      {/* Glints */}
      {[[352, 322], [478, 240], [196, 330], [640, 316]].map(([cx, cy], i) => (
        <g key={i} opacity="0.85">
          <path d={`M${cx} ${cy - 16}l3.5 12.5L${cx + 16} ${cy}l-12.5 3.5L${cx} ${cy + 16}l-3.5-12.5L${cx - 16} ${cy}l12.5-3.5z`} fill="#fff6dd" />
        </g>
      ))}
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 3. Margin. The same product, twice, at two prices.
// ---------------------------------------------------------------------------

export function MarginScene({ className }: { className?: string }) {
  const id = "margin";
  const bars = [
    { h: 58, label: 0 },
    { h: 92, label: 1 },
    { h: 128, label: 2 },
    { h: 176, label: 3 },
    { h: 232, label: 4 },
  ];
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.34} />
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {/* Grid */}
      {Array.from({ length: 6 }).map((_, i) => (
        <path key={i} d={`M96 ${380 - i * 58}h610`} stroke="#ffffff" strokeOpacity="0.055" strokeWidth="1" />
      ))}
      <path d="M96 380h610" stroke={GOLD.deep} strokeOpacity="0.5" strokeWidth="2" />

      {bars.map((bar, i) => {
        const x = 140 + i * 108;
        const y = 380 - bar.h;
        return (
          <g key={i}>
            <rect x={x} y={y} width="62" height={bar.h} rx="3" fill={`url(#${id}-bar)`} opacity={0.35 + i * 0.16} />
            <rect x={x} y={y} width="62" height="7" rx="3" fill="#fff3d0" opacity="0.75" />
            <rect x={x} y={y} width="9" height={bar.h} fill="#fff" opacity="0.12" />
          </g>
        );
      })}

      {/* Trend line over the bars */}
      <path
        d="M171 322L279 288L387 252L495 204L603 148"
        fill="none"
        stroke={GOLD.pale}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 9"
      />
      {[171, 279, 387, 495, 603].map((cx, i) => (
        <circle key={cx} cy={[322, 288, 252, 204, 148][i]} cx={cx} r="6" fill={GOLD.pale} />
      ))}

      {/* Arrow head */}
      <path d="M603 148l-16 6 6-16z" fill={GOLD.pale} transform="rotate(28 603 148)" />

      {/* Coins piling at the foot of the tallest bar */}
      <CoinStack x={648} y={380} count={4} id={id} />
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 4. The catalogue, as a lit shelf.
// ---------------------------------------------------------------------------

export function ShelfScene({ className }: { className?: string }) {
  const id = "shelf";
  const shelves = [148, 250, 352];
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.3} />
        <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3229" />
          <stop offset="100%" stopColor="#241f19" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {shelves.map((y, row) => (
        <g key={y}>
          {/* Pool of light on each shelf */}
          <ellipse cx="400" cy={y - 4} rx="290" ry="26" fill={GOLD.light} opacity="0.07" />
          <rect x="88" y={y} width="624" height="11" rx="2" fill={`url(#${id}-wood)`} />
          <rect x="88" y={y} width="624" height="2.5" fill={GOLD.mid} opacity="0.4" />

          {Array.from({ length: 9 }).map((_, i) => {
            const x = 118 + i * 70;
            const kind = (row * 9 + i) % 6;
            const tall = 34 + ((row * 5 + i * 3) % 5) * 9;
            return (
              <g key={i} opacity={0.9}>
                {kind === 0 && <rect x={x} y={y - tall} width="34" height={tall} rx="4" fill="#4c5461" />}
                {kind === 1 && (
                  <>
                    <rect x={x + 8} y={y - tall} width="18" height={tall} rx="8" fill="#5c5044" />
                    <rect x={x + 12} y={y - tall - 10} width="10" height="12" rx="3" fill="#3d352c" />
                  </>
                )}
                {kind === 2 && <ellipse cx={x + 17} cy={y - tall / 2} rx="19" ry={tall / 2} fill="#4a5a52" />}
                {kind === 3 && (
                  <>
                    <path d={`M${x} ${y}v-${tall}h34v${tall}z`} fill="#585062" />
                    <path d={`M${x} ${y - tall}h34l-6-12h-22z`} fill="#6d6478" />
                  </>
                )}
                {kind === 4 && <rect x={x + 2} y={y - tall} width="30" height={tall} rx="15" fill="#4d5b64" />}
                {kind === 5 && (
                  <>
                    <rect x={x} y={y - tall} width="34" height={tall} rx="3" fill="#5a4a3a" />
                    <rect x={x + 5} y={y - tall + 7} width="24" height="10" rx="2" fill={GOLD.mid} opacity="0.65" />
                  </>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {/* Uprights */}
      <rect x="76" y="96" width="14" height="304" fill="#1d2027" />
      <rect x="710" y="96" width="14" height="304" fill="#1d2027" />
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 5. Logistics. Racking, pallets and a truck on the dock.
// ---------------------------------------------------------------------------

export function WarehouseScene({ className }: { className?: string }) {
  const id = "wh";
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.3} />
        <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1e26" />
          <stop offset="100%" stopColor="#0a0c10" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="360" fill={`url(#${id}-warm)`} />
      <rect y="330" width="800" height="170" fill={`url(#${id}-floor)`} />

      {/* Roof trusses */}
      {Array.from({ length: 7 }).map((_, i) => (
        <path key={i} d={`M${60 + i * 116} 0v58M${40 + i * 116} 58h${i === 6 ? 120 : 140}`} stroke="#262c36" strokeWidth="5" />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <g key={i}>
          <rect x={124 + i * 140} y="58" width="72" height="9" rx="4" fill="#f4e6c4" opacity="0.85" />
          <ellipse cx={160 + i * 140} cy="120" rx="90" ry="58" fill={GOLD.light} opacity="0.06" />
        </g>
      ))}

      {/* Racking, receding */}
      {[
        { x: 40, w: 210, y: 150, s: 1 },
        { x: 560, w: 210, y: 150, s: 1 },
      ].map((rack, r) => (
        <g key={r}>
          <rect x={rack.x} y={rack.y} width="10" height="184" fill="#39414d" />
          <rect x={rack.x + rack.w - 10} y={rack.y} width="10" height="184" fill="#39414d" />
          {[0, 1, 2].map((lvl) => {
            const y = rack.y + 26 + lvl * 58;
            return (
              <g key={lvl}>
                <rect x={rack.x} y={y} width={rack.w} height="8" fill={GOLD.deep} opacity="0.75" />
                {[0, 1, 2].map((b) => (
                  <g key={b}>
                    <rect x={rack.x + 14 + b * 64} y={y - 42} width="52" height="42" rx="2" fill="#6b5a44" />
                    <rect x={rack.x + 14 + b * 64} y={y - 42} width="52" height="9" fill="#8a7455" />
                    <rect x={rack.x + 22 + b * 64} y={y - 26} width="36" height="12" rx="2" fill={GOLD.mid} opacity="0.5" />
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      ))}

      {/* Dock door with the truck backed in */}
      <rect x="290" y="146" width="220" height="188" rx="4" fill="#0d1016" />
      <rect x="290" y="146" width="220" height="188" rx="4" fill="none" stroke="#333b47" strokeWidth="4" />
      <rect x="302" y="176" width="196" height="132" rx="3" fill="#1d232c" />
      <rect x="302" y="176" width="196" height="132" rx="3" fill={GOLD.light} opacity="0.07" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="302" y={176 + i * 33} width="196" height="3" fill="#0c0f14" />
      ))}

      {/* Pallets on the floor, foreground */}
      {[[120, 360], [214, 372], [618, 366]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y - 46} width="76" height="46" rx="2" fill="#7a6748" />
          <rect x={x} y={y - 46} width="76" height="10" fill="#98814f" />
          <rect x={x + 12} y={y - 30} width="52" height="14" rx="2" fill={GOLD.mid} opacity="0.55" />
          <rect x={x - 4} y={y} width="84" height="9" rx="2" fill="#4a4034" />
          <ellipse cx={x + 38} cy={y + 15} rx="52" ry="8" fill="#000" opacity="0.4" />
        </g>
      ))}

      {/* Forklift silhouette */}
      <g transform="translate(392 300)">
        <rect x="0" y="-52" width="10" height="58" fill="#3d4552" />
        <rect x="-40" y="-34" width="46" height="34" rx="4" fill={GOLD.mid} opacity="0.8" />
        <rect x="-34" y="-56" width="30" height="24" rx="3" fill="#2b323d" />
        <circle cx="-30" cy="8" r="10" fill="#191d24" />
        <circle cx="-4" cy="8" r="8" fill="#191d24" />
        <path d="M10 0h26" stroke="#5b6472" strokeWidth="5" />
      </g>
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 6. Reach. Where the pallets go.
// ---------------------------------------------------------------------------

const NODES: { x: number; y: number; label: string; hub?: boolean }[] = [
  { x: 400, y: 168, label: "Copenhagen", hub: true },
  { x: 296, y: 132, label: "Oslo" },
  { x: 356, y: 96, label: "Stockholm" },
  { x: 318, y: 246, label: "Amsterdam" },
  { x: 232, y: 268, label: "London" },
  { x: 416, y: 268, label: "Berlin" },
  { x: 300, y: 330, label: "Paris" },
  { x: 470, y: 352, label: "Milan" },
  { x: 556, y: 232, label: "Warsaw" },
  { x: 214, y: 386, label: "Madrid" },
];

export function ReachScene({ className }: { className?: string }) {
  const id = "reach";
  const hub = NODES[0];
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.26} />
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {/* Latitude / longitude wash */}
      {Array.from({ length: 11 }).map((_, i) => (
        <path key={`h${i}`} d={`M0 ${i * 50}h800`} stroke="#ffffff" strokeOpacity="0.035" />
      ))}
      {Array.from({ length: 17 }).map((_, i) => (
        <path key={`v${i}`} d={`M${i * 50} 0v500`} stroke="#ffffff" strokeOpacity="0.035" />
      ))}

      {/* Routes out of the hub */}
      {NODES.slice(1).map((node, i) => {
        const mx = (hub.x + node.x) / 2;
        const my = (hub.y + node.y) / 2 - 46;
        return (
          <path
            key={node.label}
            d={`M${hub.x} ${hub.y}Q${mx} ${my} ${node.x} ${node.y}`}
            fill="none"
            stroke={GOLD.light}
            strokeOpacity={0.34 + (i % 3) * 0.12}
            strokeWidth="1.8"
            strokeDasharray="5 6"
          />
        );
      })}

      {NODES.map((node) => (
        <g key={node.label}>
          {node.hub && <circle cx={node.x} cy={node.y} r="26" fill={GOLD.mid} opacity="0.16" />}
          {node.hub && <circle cx={node.x} cy={node.y} r="15" fill={GOLD.mid} opacity="0.28" />}
          <circle cx={node.x} cy={node.y} r={node.hub ? 8 : 4.5} fill={node.hub ? GOLD.pale : GOLD.light} />
          <text
            x={node.x}
            y={node.y - (node.hub ? 20 : 13)}
            textAnchor="middle"
            fill={node.hub ? GOLD.pale : "#c9cfd8"}
            fontSize={node.hub ? 15 : 12}
            fontFamily="var(--font-mono), monospace"
            letterSpacing="1.4"
            opacity={node.hub ? 1 : 0.75}
          >
            {node.label.toUpperCase()}
          </text>
        </g>
      ))}
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 7. How ordering works: three frames, one line through them.
// ---------------------------------------------------------------------------

export function FlowScene({ className }: { className?: string }) {
  const id = "flow";
  const frames = [96, 320, 544];
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.24} />
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      <path d="M256 250h64M480 250h64" stroke={GOLD.mid} strokeWidth="2" strokeDasharray="6 7" />
      {[312, 536].map((x) => (
        <path key={x} d={`M${x} 250l-11 6v-12z`} fill={GOLD.light} />
      ))}

      {frames.map((x, i) => (
        <g key={x}>
          <rect x={x} y="146" width="160" height="208" rx="10" fill="#141821" stroke="#2c3341" strokeWidth="1.5" />
          <rect x={x} y="146" width="160" height="34" rx="10" fill="#1c2230" />
          <circle cx={x + 18} cy="163" r="4" fill={GOLD.mid} opacity="0.7" />
          <text x={x + 34} y="168" fill="#7d8798" fontSize="11" fontFamily="var(--font-mono), monospace" letterSpacing="1.6">
            {["BROWSE", "ORDER", "DISPATCH"][i]}
          </text>

          {i === 0 && (
            <g>
              {[0, 1, 2, 3].map((r) =>
                [0, 1, 2].map((c) => (
                  <rect key={`${r}-${c}`} x={x + 18 + c * 44} y={198 + r * 38} width="36" height="30" rx="4" fill="#252c39" />
                ))
              )}
              <rect x={x + 18} y="198" width="36" height="30" rx="4" fill={GOLD.mid} opacity="0.8" />
              <rect x={x + 106} y="274" width="36" height="30" rx="4" fill={GOLD.mid} opacity="0.55" />
            </g>
          )}

          {i === 1 && (
            <g>
              <rect x={x + 26} y="196" width="108" height="140" rx="5" fill="#f2ece0" opacity="0.94" />
              <path d={`M${x + 40} 216h80M${x + 40} 232h80M${x + 40} 248h56`} stroke="#5d6675" strokeWidth="3" strokeLinecap="round" />
              <path d={`M${x + 40} 274h80M${x + 40} 288h44`} stroke="#9aa3b1" strokeWidth="3" strokeLinecap="round" />
              <rect x={x + 40} y="304" width="46" height="18" rx="3" fill={GOLD.mid} />
              <path d={`M${x + 96} 316l10 10 22-26`} stroke="#2f7d54" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}

          {i === 2 && (
            <g>
              <rect x={x + 20} y="236" width="76" height="52" rx="5" fill="#8a7455" />
              <rect x={x + 20} y="236" width="76" height="11" fill="#a58c66" />
              <path d={`M${x + 100} 252h22l16 20v16h-38z`} fill={GOLD.mid} opacity="0.85" />
              <rect x={x + 104} y="256" width="14" height="12" rx="2" fill="#1a1e26" opacity="0.6" />
              <circle cx={x + 40} cy="296" r="9" fill="#1a1e26" />
              <circle cx={x + 118} cy="296" r="9" fill="#1a1e26" />
              <path d={`M${x + 18} 306h124`} stroke="#39414f" strokeWidth="3" />
              <path d={`M${x + 30} 218h44`} stroke={GOLD.light} strokeWidth="3" strokeDasharray="4 5" strokeLinecap="round" />
            </g>
          )}
        </g>
      ))}
      <Grain id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 8. The other end of the chain: the reseller's own shop window.
// ---------------------------------------------------------------------------

export function StorefrontScene({ className }: { className?: string }) {
  const id = "store";
  return (
    <svg className={className} {...stage} aria-hidden>
      <defs>
        <SceneBase id={id} warm={0.36} />
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#ffdfa4" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffdfa4" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill={`url(#${id}-sky)`} />
      <rect width="800" height="500" fill={`url(#${id}-warm)`} />

      {/* Pavement */}
      <rect y="400" width="800" height="100" fill="#0c0e13" />
      <path d="M0 400h800" stroke={GOLD.deep} strokeOpacity="0.4" strokeWidth="2" />

      {/* Facade */}
      <rect x="110" y="70" width="580" height="330" fill="#12161d" />
      <rect x="110" y="70" width="580" height="46" fill="#191e27" />
      <text
        x="400"
        y="102"
        textAnchor="middle"
        fill={GOLD.pale}
        fontSize="21"
        letterSpacing="9"
        fontFamily="var(--font-mono), monospace"
      >
        YOUR SHOP
      </text>

      {/* Awning */}
      <path d="M96 116h608l-22 44H118z" fill={GOLD.deep} opacity="0.55" />
      {Array.from({ length: 12 }).map((_, i) => (
        <path key={i} d={`M${118 + i * 51} 116l-5 44`} stroke={GOLD.pale} strokeOpacity="0.18" strokeWidth="3" />
      ))}

      {/* Windows */}
      {[[150, 300], [450, 300]].map(([x, w], i) => (
        <g key={i}>
          <rect x={x} y="180" width={w} height="180" rx="4" fill="#1b212b" />
          <rect x={x} y="180" width={w} height="180" rx="4" fill={`url(#${id}-glass)`} />
          <ellipse cx={x + w / 2} cy="230" rx={w / 2 - 10} ry="42" fill={GOLD.light} opacity="0.1" />
          {/* Display plinths */}
          {[0, 1, 2].map((b) => {
            const px = x + 30 + b * (w - 90) / 2;
            const h = 40 + ((i * 3 + b) % 3) * 18;
            return (
              <g key={b}>
                <rect x={px - 4} y={320 - h} width="48" height={h} rx="4" fill={["#5f6b78", "#7a6248", "#4e6157"][(i + b) % 3]} />
                <rect x={px - 4} y={320 - h} width="48" height="8" rx="4" fill="#fff" opacity="0.16" />
                <rect x={px - 12} y="320" width="64" height="9" rx="2" fill="#2a303a" />
              </g>
            );
          })}
          <path d={`M${x + 12} 190l${w - 60} 160`} stroke="#fff" strokeOpacity="0.06" strokeWidth="24" />
        </g>
      ))}

      {/* Door */}
      <rect x="368" y="230" width="64" height="130" rx="3" fill="#232a35" />
      <rect x="368" y="230" width="64" height="130" rx="3" fill={`url(#${id}-glass)`} />
      <circle cx="422" cy="298" r="3.5" fill={GOLD.pale} />
      <ellipse cx="400" cy="376" rx="120" ry="18" fill={GOLD.light} opacity="0.09" />
      <Grain id={id} />
    </svg>
  );
}
