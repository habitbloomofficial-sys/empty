import type { ArtKey, ToneKey } from "@/lib/shop/catalog";
import { TONES, type Paint } from "./ArtDefs";

/*
 * Product photography, drawn rather than shot.
 *
 * The real range isn't chosen yet, so there is nothing to photograph. Stock
 * photos would each carry their own lighting, background and crop and the grid
 * would look like a scrapbook. These are thirty illustrations on one stage with
 * one light source, so the catalogue reads as a single considered set — and
 * they stay sharp at any size and weigh nothing over the wire.
 *
 * When the client's photography arrives, swap the <ProductArt/> in ProductCard
 * for an <Image/> and the rest of the shop does not change.
 */

// Rounded so the server and client render byte-identical path data; raw trig
// floats differ in their last bits and trip React's hydration check.
const round2 = (n: number) => Math.round(n * 100) / 100;

type Ref = (name: "body" | "side" | "tint" | "halo") => string;

type Draw = (p: Paint, u: Ref) => React.ReactElement;

const SHAPES: Record<ArtKey, Draw> = {
  // --- home ---------------------------------------------------------------
  lamp: (p, u) => (
    <>
      <path d="M98 186h44l-5-20h-34z" fill={p.d} />
      <ellipse cx="120" cy="186" rx="26" ry="6" fill={p.m} />
      <rect x="116" y="116" width="8" height="52" fill={u("side")} />
      <path d="M92 60h56l16 56H76z" fill={u("body")} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={`M${96 + i * 8} 60 L${88 + i * 10.7} 116`}
          stroke={p.t}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
      ))}
      <ellipse cx="120" cy="60" rx="28" ry="7" fill={p.l} />
      <ellipse cx="120" cy="116" rx="44" ry="9" fill={p.t} fillOpacity="0.75" />
      <path d="M92 60h14l-8 56H76z" fill="#fff" fillOpacity="0.16" />
    </>
  ),
  vase: (p, u) => (
    <>
      <path
        d="M104 62h32l-2 26c20 11 32 31 32 52 0 26-19 44-46 44s-46-18-46-44c0-21 12-41 32-52z"
        fill={u("body")}
      />
      <ellipse cx="120" cy="62" rx="16" ry="5" fill={p.d} />
      <ellipse cx="120" cy="62" rx="11" ry="3" fill={p.d} fillOpacity="0.6" />
      <path d="M104 62h9l-1 27c-16 10-26 29-26 49 0 16 7 29 19 36-19-5-31-20-31-38 0-21 12-41 32-52z" fill="#fff" fillOpacity="0.2" />
      <ellipse cx="146" cy="132" rx="9" ry="20" fill={p.d} fillOpacity="0.28" />
    </>
  ),
  throw: (p, u) => (
    <>
      <rect x="58" y="140" width="124" height="34" rx="8" fill={p.d} />
      <rect x="64" y="112" width="112" height="36" rx="8" fill={u("side")} />
      <rect x="70" y="82" width="100" height="38" rx="9" fill={u("body")} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${78 + i * 17} 82v38`} stroke={p.t} strokeOpacity="0.4" strokeWidth="3" />
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path key={i} d={`M${66 + i * 15} 174v10`} stroke={p.m} strokeWidth="2" strokeLinecap="round" />
      ))}
      <rect x="70" y="82" width="100" height="10" rx="5" fill="#fff" fillOpacity="0.22" />
    </>
  ),
  cushion: (p, u) => (
    <>
      <path d="M68 76q52-11 104 0 11 52 0 104-52 11-104 0-11-52 0-104z" fill={u("body")} />
      <path
        d="M82 90q38-8 76 0 8 38 0 76-38 8-76 0-8-38 0-76z"
        fill="none"
        stroke={p.t}
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <path d="M68 76q52-11 104 0-6 16-52 16T68 76z" fill="#fff" fillOpacity="0.2" />
    </>
  ),
  candle: (p, u) => (
    <>
      <path d="M88 104h64v58a12 12 0 0 1-12 12h-40a12 12 0 0 1-12-12z" fill={u("body")} />
      <ellipse cx="120" cy="104" rx="32" ry="9" fill={p.d} />
      <ellipse cx="120" cy="105" rx="25" ry="6.5" fill={p.t} />
      <path d="M120 99v-6" stroke={p.d} strokeWidth="2" strokeLinecap="round" />
      <path d="M120 92c5-6 3-12 0-16-3 4-5 10 0 16z" fill="#ffb545" />
      <path d="M120 90c2.5-3.5 1.6-7 0-9-1.6 2-2.6 5.5 0 9z" fill="#fff4cf" />
      <rect x="94" y="128" width="52" height="20" rx="3" fill={p.t} fillOpacity="0.9" />
      <path d="M104 138h32" stroke={p.d} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M88 104h10v70h-4a6 6 0 0 1-6-6z" fill="#fff" fillOpacity="0.18" />
    </>
  ),

  // --- wellness -----------------------------------------------------------
  diffuser: (p, u) => (
    <>
      {[-34, -20, -7, 7, 20, 34].map((angle, i) => (
        <path
          key={i}
          d="M120 128V56"
          stroke={i % 2 ? "#c8ab86" : "#b2946e"}
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${angle} 120 128)`}
        />
      ))}
      <rect x="110" y="112" width="20" height="16" fill={p.d} />
      <path d="M92 130c0-10 10-12 10-20h36c0 8 10 10 10 20v30a14 14 0 0 1-14 14h-28a14 14 0 0 1-14-14z" fill={u("body")} />
      <rect x="106" y="106" width="28" height="8" rx="3" fill={p.d} />
      <path d="M100 146h40v22a8 8 0 0 1-8 8h-24a8 8 0 0 1-8-8z" fill={p.t} fillOpacity="0.65" />
      <path d="M92 138c0-8 6-14 10-22v52a14 14 0 0 1-10-14z" fill="#fff" fillOpacity="0.2" />
    </>
  ),
  serum: (p, u) => (
    <>
      <rect x="108" y="56" width="24" height="12" rx="4" fill={p.d} />
      <rect x="110" y="66" width="20" height="30" rx="4" fill={u("side")} />
      <path d="M104 96h32l6 16v56a12 12 0 0 1-12 12h-20a12 12 0 0 1-12-12v-56z" fill={u("body")} />
      <rect x="104" y="122" width="32" height="34" rx="3" fill={p.t} fillOpacity="0.92" />
      <path d="M111 133h18M111 141h12" stroke={p.d} strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
      <path d="M104 96h9l-3 84a12 12 0 0 1-6-12z" fill="#fff" fillOpacity="0.25" />
    </>
  ),
  oil: (p, u) => (
    <>
      <path d="M112 52h16v10h-16z" fill={p.d} />
      <path d="M100 62h40v8h-40z" fill={p.d} />
      <path d="M128 56h22a6 6 0 0 1 6 6v4h-10v-2h-18z" fill={p.d} />
      <rect x="110" y="70" width="20" height="16" fill={u("side")} />
      <path d="M98 86h44v76a14 14 0 0 1-14 14h-16a14 14 0 0 1-14-14z" fill={u("body")} />
      <path d="M102 112h36v50a10 10 0 0 1-10 10h-16a10 10 0 0 1-10-10z" fill={p.d} fillOpacity="0.35" />
      <rect x="100" y="122" width="40" height="26" rx="2" fill={p.t} fillOpacity="0.9" />
      <path d="M108 132h24M108 140h16" stroke={p.d} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M98 86h8v90a14 14 0 0 1-8-14z" fill="#fff" fillOpacity="0.22" />
    </>
  ),
  soap: (p, u) => (
    <>
      <path d="M62 128l58-26 58 26-58 24z" fill={p.l} />
      <path d="M62 128v22l58 26v-24z" fill={u("side")} />
      <path d="M178 128v22l-58 26v-24z" fill={p.d} />
      <path d="M94 141l58-26 12 5-58 26z" fill={p.t} fillOpacity="0.85" />
      <path d="M94 141v22l12 5v-22z" fill={p.t} fillOpacity="0.6" />
      <circle cx="120" cy="126" r="10" fill={p.d} fillOpacity="0.35" />
      <path d="M114 126l4 4 8-9" stroke={p.t} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  balm: (p, u) => (
    <>
      <rect x="108" y="58" width="24" height="26" rx="4" fill={p.d} />
      <rect x="110" y="82" width="20" height="8" fill={u("side")} />
      <path d="M100 90h40v62l-4 12h-32l-4-12z" fill={u("body")} />
      <path d="M104 164h32l-2 10h-28z" fill={p.d} />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${106 + i * 7} 164v10`} stroke={p.t} strokeOpacity="0.5" strokeWidth="1.5" />
      ))}
      <rect x="100" y="108" width="40" height="30" rx="2" fill={p.t} fillOpacity="0.9" />
      <path d="M108 118h24M108 127h14" stroke={p.d} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M100 90h8v74l-6-12z" fill="#fff" fillOpacity="0.22" />
    </>
  ),

  // --- kitchen ------------------------------------------------------------
  board: (p, u) => (
    <>
      <path d="M62 84h116a10 10 0 0 1 10 10v58a10 10 0 0 1-10 10H62a10 10 0 0 1-10-10V94a10 10 0 0 1 10-10z" fill={u("body")} />
      <path d="M52 152h136a10 10 0 0 1-10 10H62a10 10 0 0 1-10-10z" fill={p.d} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M60 ${94 + i * 11}h120`} stroke={p.d} strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round" />
      ))}
      <rect x="62" y="90" width="116" height="10" rx="5" fill="#fff" fillOpacity="0.2" />
      <circle cx="166" cy="123" r="8" fill={p.d} fillOpacity="0.55" />
      <path d="M64 96h112a4 4 0 0 1 4 4v46H60v-46a4 4 0 0 1 4-4z" fill="none" stroke={p.t} strokeOpacity="0.4" strokeWidth="1.5" />
    </>
  ),
  knife: (p) => (
    <>
      <path d="M46 152C82 130 120 114 150 108v30c-28 5-64 13-88 20z" fill="url(#pa-steel)" />
      <path d="M46 152C82 130 120 114 150 108v6c-30 7-66 22-100 40z" fill="#fff" fillOpacity="0.7" />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M60 ${146 - i * 5}c26-14 56-24 86-29`}
          stroke="#5d6773"
          strokeOpacity="0.4"
          strokeWidth="1.4"
          fill="none"
        />
      ))}
      <path d="M148 104h8v40h-8z" fill="#96a0ac" />
      <path d="M156 104h30a12 12 0 0 1 12 12v16a12 12 0 0 1-12 12h-30z" fill={p.d} />
      <path d="M156 104h30a12 12 0 0 1 12 12v3h-42z" fill={p.m} fillOpacity="0.6" />
      <circle cx="170" cy="124" r="3.4" fill="#c9ced6" />
      <circle cx="186" cy="124" r="3.4" fill="#c9ced6" />
    </>
  ),
  pan: (p, u) => (
    <>
      <path d="M158 132c26-6 44-20 50-38 3-9-3-14-10-11-7 2-8 9-11 15-6 12-18 19-33 22z" fill={p.d} />
      <ellipse cx="108" cy="140" rx="58" ry="32" fill={p.d} />
      <ellipse cx="108" cy="135" rx="52" ry="28" fill={u("body")} />
      <ellipse cx="108" cy="133" rx="43" ry="22" fill={u("side")} />
      <ellipse cx="108" cy="131" rx="43" ry="21" fill={p.d} fillOpacity="0.5" />
      <path d="M62 124c8-10 26-17 46-17" stroke="#fff" strokeOpacity="0.28" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M50 138c-6-3-8-8-4-11" stroke={p.d} strokeWidth="6" fill="none" strokeLinecap="round" />
    </>
  ),
  cutlery: (p, u) => (
    <>
      <g fill={u("body")}>
        <path d="M70 60c-8 0-12 10-12 22 0 9 4 15 9 17l-3 71a6 6 0 0 0 12 0l-3-71c5-2 9-8 9-17 0-12-4-22-12-22z" />
        <path d="M114 58h6v30h4V58h6v30h4V58h6v34c0 8-4 13-9 15l-3 63a5.5 5.5 0 0 1-11 0l-3-63c-5-2-9-7-9-15V58h6v30h3z" transform="translate(4)" />
        <path d="M170 58c9 4 14 14 14 26 0 8-3 13-7 15l-3 71a6 6 0 0 1-12 0l-3-71c-4-2-7-7-7-15 0-12 5-22 14-26z" />
      </g>
      <g fill="#fff" fillOpacity="0.28">
        <path d="M70 60c-4 0-6 10-6 22 0 9 2 15 4 17l-1 71h-3l-3-71c-5-2-9-8-9-17 0-12 4-22 12-22z" />
        <path d="M170 58c-4 4-6 14-6 26 0 8 1 13 3 15l-2 71h-3l-3-71c-4-2-7-7-7-15 0-12 5-22 14-26z" />
      </g>
      <ellipse cx="70" cy="80" rx="9" ry="18" fill={p.d} fillOpacity="0.4" />
    </>
  ),
  glass: (p, u) => (
    <>
      <path d="M136 104h44c0 0-3 40-9 52-4 8-9 12-13 12s-9-4-13-12c-6-12-9-52-9-52z" fill={p.t} fillOpacity="0.5" />
      <path d="M136 104h44c0 0-1 10-2 18h-40c-1-8-2-18-2-18z" fill={u("side")} fillOpacity="0.45" />
      <path d="M84 96h56c0 0-4 50-11 65-5 10-12 15-17 15s-12-5-17-15c-7-15-11-65-11-65z" fill={p.t} fillOpacity="0.72" />
      <path d="M90 118h44c-2 20-6 40-10 47-3 7-7 11-12 11s-9-4-12-11c-4-7-8-27-10-47z" fill={u("body")} fillOpacity="0.5" />
      <ellipse cx="112" cy="96" rx="28" ry="7" fill={p.l} fillOpacity="0.9" />
      <ellipse cx="112" cy="97" rx="22" ry="5" fill={p.d} fillOpacity="0.55" />
      <ellipse cx="158" cy="104" rx="22" ry="6" fill={p.l} fillOpacity="0.8" />
      <path d="M92 104c1 22 4 44 9 55" stroke="#fff" strokeOpacity="0.75" strokeWidth="3" fill="none" strokeLinecap="round" />
    </>
  ),

  // --- tech ---------------------------------------------------------------
  speaker: (p, u) => (
    <>
      <path d="M170 96c14 4 20 12 20 24s-6 20-20 24z" fill={p.d} />
      <rect x="56" y="86" width="118" height="72" rx="20" fill={u("body")} />
      <rect x="66" y="96" width="98" height="52" rx="14" fill={p.d} fillOpacity="0.55" />
      {Array.from({ length: 5 }).map((_, row) =>
        Array.from({ length: 11 }).map((__, col) => (
          <circle key={`${row}-${col}`} cx={76 + col * 8.8} cy={106 + row * 8.8} r="2.2" fill={p.t} fillOpacity="0.42" />
        ))
      )}
      <rect x="56" y="86" width="118" height="16" rx="8" fill="#fff" fillOpacity="0.16" />
      <circle cx="120" cy="168" r="3" fill={p.l} />
      <rect x="88" y="164" width="20" height="6" rx="3" fill={p.d} fillOpacity="0.5" />
      <rect x="132" y="164" width="20" height="6" rx="3" fill={p.d} fillOpacity="0.5" />
    </>
  ),
  headphones: (p, u) => (
    <>
      <path d="M64 148V124a56 56 0 0 1 112 0v24" fill="none" stroke={u("body")} strokeWidth="14" strokeLinecap="round" />
      <path d="M70 130a50 50 0 0 1 100 0" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="5" strokeLinecap="round" />
      <rect x="48" y="128" width="34" height="52" rx="16" fill={u("side")} />
      <rect x="158" y="128" width="34" height="52" rx="16" fill={u("side")} />
      <rect x="56" y="136" width="20" height="36" rx="10" fill={p.t} fillOpacity="0.55" />
      <rect x="164" y="136" width="20" height="36" rx="10" fill={p.t} fillOpacity="0.55" />
      <circle cx="66" cy="154" r="5" fill={p.d} fillOpacity="0.6" />
      <circle cx="174" cy="154" r="5" fill={p.d} fillOpacity="0.6" />
    </>
  ),
  charger: (p, u) => (
    <>
      <path d="M66 176l14-38h84l14 38z" fill={p.d} fillOpacity="0.35" />
      <rect x="72" y="140" width="96" height="24" rx="10" fill={u("body")} />
      <ellipse cx="120" cy="140" rx="26" ry="7" fill={p.t} fillOpacity="0.5" />
      <g transform="rotate(-14 132 108)">
        <rect x="100" y="60" width="64" height="76" rx="10" fill={u("side")} />
        <rect x="106" y="66" width="52" height="64" rx="7" fill={p.d} fillOpacity="0.45" />
        <circle cx="132" cy="98" r="14" fill={p.t} fillOpacity="0.45" />
        <circle cx="132" cy="98" r="7" fill={p.l} fillOpacity="0.8" />
      </g>
      <circle cx="76" cy="128" r="14" fill={u("side")} />
      <circle cx="76" cy="128" r="8" fill={p.t} fillOpacity="0.6" />
    </>
  ),
  cable: (p, u) => (
    <>
      <circle cx="120" cy="124" r="42" fill="none" stroke={u("body")} strokeWidth="13" />
      <circle cx="120" cy="124" r="42" fill="none" stroke={p.t} strokeOpacity="0.4" strokeWidth="13" strokeDasharray="4 7" />
      <circle cx="120" cy="124" r="27" fill="none" stroke={u("side")} strokeWidth="11" />
      <circle cx="120" cy="124" r="27" fill="none" stroke={p.t} strokeOpacity="0.35" strokeWidth="11" strokeDasharray="4 6" />
      <path d="M78 124c-14 0-22 12-22 24" fill="none" stroke={u("body")} strokeWidth="13" strokeLinecap="round" />
      <rect x="46" y="146" width="20" height="30" rx="5" fill={p.d} />
      <rect x="50" y="150" width="12" height="14" rx="6" fill="url(#pa-steel)" />
      <path d="M162 124c14 0 20-10 20-22" fill="none" stroke={u("body")} strokeWidth="13" strokeLinecap="round" />
      <rect x="172" y="70" width="20" height="30" rx="5" fill={p.d} />
      <rect x="176" y="86" width="12" height="14" rx="6" fill="url(#pa-steel)" />
    </>
  ),
  watch: (p, u) => (
    <>
      <path d="M100 58h40v42h-40z" fill={u("side")} />
      <path d="M100 152h40v40a6 6 0 0 1-6 6h-28a6 6 0 0 1-6-6z" fill={u("side")} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M100 ${64 + i * 9}h40`} stroke={p.d} strokeOpacity="0.35" strokeWidth="1.6" />
      ))}
      <rect x="164" y="118" width="8" height="14" rx="3" fill="url(#pa-gold)" />
      <circle cx="120" cy="126" r="42" fill="url(#pa-gold)" />
      <circle cx="120" cy="126" r="35" fill={p.t} />
      <circle cx="120" cy="126" r="35" fill="url(#pa-sheen)" fillOpacity="0.5" />
      {[0, 3, 6, 9].map((h) => {
        const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
        return (
          <path
            key={h}
            d={`M${round2(120 + Math.cos(a) * 30)} ${round2(126 + Math.sin(a) * 30)}L${round2(120 + Math.cos(a) * 25)} ${round2(126 + Math.sin(a) * 25)}`}
            stroke={p.d}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        );
      })}
      <path d="M120 126V104" stroke={p.d} strokeWidth="3" strokeLinecap="round" />
      <path d="M120 126l17 10" stroke={p.d} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="120" cy="126" r="3" fill={p.d} />
    </>
  ),

  // --- outdoor ------------------------------------------------------------
  backpack: (p, u) => (
    <>
      <path d="M84 84c-6-16 4-26 12-26h48c8 0 18 10 12 26z" fill={p.d} />
      <path d="M74 96c0-16 12-24 26-24h40c14 0 26 8 26 24v66a16 16 0 0 1-16 16H90a16 16 0 0 1-16-16z" fill={u("body")} />
      <path d="M74 96c0-16 12-24 26-24h12c-10 4-16 12-16 24v82h-6a16 16 0 0 1-16-16z" fill="#fff" fillOpacity="0.16" />
      <path d="M92 122h56a8 8 0 0 1 8 8v30H84v-30a8 8 0 0 1 8-8z" fill={u("side")} />
      <rect x="106" y="146" width="28" height="12" rx="3" fill={p.d} />
      <path d="M100 72c0-10 8-16 20-16s20 6 20 16" fill="none" stroke={p.d} strokeWidth="7" strokeLinecap="round" />
      <path d="M86 96h68" stroke={p.d} strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  flask: (p, u) => (
    <>
      <rect x="104" y="52" width="32" height="24" rx="7" fill={p.d} />
      <rect x="106" y="72" width="28" height="8" fill={u("side")} />
      <path d="M96 96c0-10 6-14 6-20h36c0 6 6 10 6 20v66a16 16 0 0 1-16 16h-16a16 16 0 0 1-16-16z" fill={u("body")} />
      <path d="M96 100c0-8 4-12 6-20v98a16 16 0 0 1-6-12z" fill="#fff" fillOpacity="0.24" />
      <rect x="98" y="118" width="44" height="30" rx="2" fill={p.t} fillOpacity="0.9" />
      <path d="M106 130h28M106 139h18" stroke={p.d} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M138 100v78" stroke={p.d} strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  umbrella: (p, u) => (
    <>
      <path d="M50 122a70 70 0 0 1 140 0z" fill={u("body")} />
      <path d="M50 122q17 16 35 0 17 16 35 0 17 16 35 0 17 16 35 0v6H50z" fill={u("body")} />
      <path d="M50 122a70 70 0 0 1 35-60q-16 22-16 60z" fill="#fff" fillOpacity="0.2" />
      <path d="M120 52v70M85 62q-16 22-16 60M155 62q16 22 16 60" stroke={p.d} strokeOpacity="0.35" strokeWidth="2" fill="none" />
      <circle cx="120" cy="50" r="5" fill={p.d} />
      <path d="M117 122h6v48h-6z" fill={p.d} />
      <path d="M123 170c0 14-20 14-20 2" fill="none" stroke={p.d} strokeWidth="6" strokeLinecap="round" />
    </>
  ),
  towel: (p, u) => (
    <>
      <rect x="52" y="136" width="70" height="20" rx="6" fill={u("side")} />
      <rect x="56" y="152" width="66" height="20" rx="6" fill={p.d} />
      <circle cx="152" cy="128" r="46" fill={u("body")} />
      <path
        d="M152 82a46 46 0 1 1-46 46 34 34 0 0 1 34-34 24 24 0 0 1 24 24 14 14 0 0 1-14 14"
        fill="none"
        stroke={p.t}
        strokeOpacity="0.55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="152" cy="128" r="46" fill="url(#pa-sheen)" fillOpacity="0.28" />
      <rect x="52" y="136" width="70" height="7" rx="3.5" fill="#fff" fillOpacity="0.22" />
    </>
  ),
  mug: (p, u) => (
    <>
      <path d="M150 116c20 0 28 10 28 22s-8 22-28 22v-12c10 0 14-4 14-10s-4-10-14-10z" fill={u("side")} />
      <path d="M84 104h68l-6 62a12 12 0 0 1-12 11h-32a12 12 0 0 1-12-11z" fill={u("body")} />
      <ellipse cx="118" cy="104" rx="34" ry="9" fill={p.d} />
      <ellipse cx="118" cy="104" rx="27" ry="6.5" fill={p.t} />
      <path d="M84 104h10l6 73h-4a12 12 0 0 1-12-11z" fill="#fff" fillOpacity="0.2" />
      {[[100, 128], [132, 122], [112, 148], [140, 152], [96, 158]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.4" fill={p.t} fillOpacity="0.55" />
      ))}
    </>
  ),

  // --- paper --------------------------------------------------------------
  notebook: (p, u) => (
    <>
      <path d="M76 56h84a8 8 0 0 1 8 8v112a8 8 0 0 1-8 8H76z" fill={p.t} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M162 ${62 + i * 2}v112`} stroke={p.d} strokeOpacity="0.14" strokeWidth="1" />
      ))}
      <path d="M70 56h82a8 8 0 0 1 8 8v112a8 8 0 0 1-8 8H70z" fill={u("body")} />
      <path d="M70 56h14v128H70z" fill={p.d} />
      <path d="M84 56h68a8 8 0 0 1 8 8v10H84z" fill="#fff" fillOpacity="0.14" />
      <path d="M146 56v128" stroke={p.d} strokeOpacity="0.5" strokeWidth="4" />
      <rect x="100" y="104" width="40" height="26" rx="2" fill="url(#pa-gold)" fillOpacity="0.85" />
      <path d="M108 114h24M108 122h14" stroke={p.d} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      <path d="M120 184v14l6-6 6 6v-14z" fill={p.m} />
    </>
  ),
  pen: (p) => (
    <g transform="rotate(-24 120 120)">
      <path d="M114 44h12a6 6 0 0 1 6 6v122h-24V50a6 6 0 0 1 6-6z" fill="url(#pa-gold)" />
      <path d="M114 44h6v128h-12V50a6 6 0 0 1 6-6z" fill="#fff" fillOpacity="0.3" />
      <path d="M108 172h24l-8 22h-8z" fill="#3a3a3a" />
      <path d="M118 194h4l-2 8z" fill="#1c1c1c" />
      <path d="M132 58h6a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4h-6z" fill="#a8862c" />
      <path d="M108 112h24" stroke={p.d} strokeOpacity="0.4" strokeWidth="2" />
      <path d="M108 118h24" stroke={p.d} strokeOpacity="0.4" strokeWidth="2" />
    </g>
  ),
  cards: (p, u) => (
    <>
      <g transform="rotate(-14 120 130)">
        <rect x="58" y="82" width="80" height="100" rx="4" fill={p.t} />
        <rect x="58" y="82" width="80" height="100" rx="4" fill={u("body")} fillOpacity="0.25" />
      </g>
      <g transform="rotate(-4 120 130)">
        <rect x="74" y="76" width="80" height="100" rx="4" fill={p.t} />
        <path d="M74 80a4 4 0 0 1 4-4h72a4 4 0 0 1 4 4v22H74z" fill={u("body")} fillOpacity="0.35" />
      </g>
      <g transform="rotate(7 120 130)">
        <rect x="90" y="70" width="80" height="100" rx="4" fill="#fdfbf6" />
        <path d="M104 100h52M104 112h52M104 124h34" stroke={p.d} strokeOpacity="0.35" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M118 142c0-8 6-12 12-6 6-6 12-2 12 6 0 8-12 16-12 16s-12-8-12-16z" fill={u("body")} fillOpacity="0.75" />
      </g>
    </>
  ),
  frame: (p, u) => (
    <>
      <path d="M148 168l22 22h-16l-16-16z" fill={p.d} fillOpacity="0.5" />
      <rect x="66" y="52" width="108" height="132" rx="5" fill={u("body")} />
      <rect x="66" y="52" width="108" height="132" rx="5" fill="url(#pa-sheen)" fillOpacity="0.3" />
      <rect x="80" y="66" width="80" height="104" rx="2" fill="#fbf8f2" />
      <rect x="90" y="76" width="60" height="84" rx="1" fill={p.t} />
      <path d="M90 142l20-28 14 18 12-14 14 24v8H90z" fill={u("side")} fillOpacity="0.85" />
      <circle cx="132" cy="96" r="9" fill="url(#pa-gold)" />
      <path d="M66 52h108v10H66z" fill="#fff" fillOpacity="0.2" />
    </>
  ),
  giftbox: (p, u) => (
    <>
      <rect x="74" y="112" width="92" height="66" rx="4" fill={u("body")} />
      <rect x="74" y="112" width="92" height="66" rx="4" fill="url(#pa-sheen)" fillOpacity="0.22" />
      <rect x="66" y="94" width="108" height="24" rx="5" fill={u("side")} />
      <rect x="66" y="94" width="108" height="9" rx="4.5" fill="#fff" fillOpacity="0.22" />
      <rect x="110" y="94" width="20" height="84" fill="url(#pa-gold)" fillOpacity="0.9" />
      <path d="M120 94c-10-6-24-6-26-18-1-8 8-12 14-6 6 5 10 14 12 24z" fill="url(#pa-gold)" />
      <path d="M120 94c10-6 24-6 26-18 1-8-8-12-14-6-6 5-10 14-12 24z" fill="url(#pa-gold)" />
      <circle cx="120" cy="90" r="6" fill="#e6c464" />
      <path d="M74 138h92" stroke={p.d} strokeOpacity="0.2" strokeWidth="2" />
    </>
  ),
};

export function ProductArt({
  art,
  tone,
  className,
}: {
  art: ArtKey;
  tone: ToneKey;
  className?: string;
}) {
  const paint = TONES[tone];
  const url: Ref = (name) => `url(#pa-${tone}-${name})`;

  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      role="img"
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width="240" height="240" fill={url("halo")} />
      <ellipse cx="120" cy="196" rx="70" ry="13" fill="url(#pa-floor)" />
      {SHAPES[art](paint, url)}
    </svg>
  );
}
