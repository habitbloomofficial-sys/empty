"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BRAND, TERMS } from "@/lib/shop/brand";
import { CATALOGUE_FACTS, PRODUCTS, findProduct } from "@/lib/shop/catalog";
import { group, money, moneyRound, multiple, percent } from "@/lib/shop/format";
import {
  FlowScene,
  GoldScene,
  MarginScene,
  ReachScene,
  ShelfScene,
  StorefrontScene,
  VaultScene,
  WarehouseScene,
} from "./Scenes";
import { ProductArt } from "./ProductArt";
import { IconArrow, IconBack } from "./Icons";

/*
 * The introduction.
 *
 * A buyer arriving here has been handed a code by a salesperson and has no idea
 * what the range is, what the margins look like, or how ordering works. Rather
 * than drop them into a grid of thirty unfamiliar products, this walks them
 * through it once — eight slides — and then gets out of the way for good. It
 * runs on arrival and never again unless asked for by name.
 *
 * The wheel drives it. Nothing advances on a timer, because a buyer reading the
 * volume breaks and a buyer who has read them before want very different things
 * from the same slide, and only one of them can be guessed at by a stopwatch.
 * Position is held as a float, so two slides cross-fade through each other in
 * step with the scroll rather than cutting at a threshold.
 *
 * Everything numeric on these slides is computed from the catalogue, so the
 * pitch cannot drift out of step with the products behind it.
 */

// Wheel travel that moves the film on by one slide. A mouse notch is about
// 100px, so a slide is roughly four notches — far enough that the cross-fade
// reads as a fade rather than a cut, close enough that eight slides aren't a
// chore. Touch is scaled separately, below: a thumb drags shorter than a wheel.
const SCROLL_PER_SLIDE = 420;
// Milliseconds for the distance still to travel to halve. Low enough that the
// film feels tied to the hand, high enough to smooth a notchy wheel.
const GLIDE_HALF_LIFE = 90;

// Whether this reader has asked the operating system for less movement. It is
// an external system that can change while the page is open, so it is
// subscribed to rather than read once.
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const readMotion = () => window.matchMedia(REDUCED).matches;
const readMotionOnServer = () => false;

/** Five lines that between them show the range isn't all one thing. */
const PEEK = ["HL-101", "WB-202", "KD-302", "TA-402", "OT-501"]
  .map((sku) => findProduct(sku))
  .filter((p): p is NonNullable<typeof p> => Boolean(p));

interface Fact {
  value: string;
  label: string;
}

interface Slide {
  id: string;
  kicker: string;
  scene: React.ReactNode;
  headline: React.ReactNode;
  lede: string;
  facts?: Fact[];
  bullets?: [string, string][];
  peek?: boolean;
  finale?: boolean;
}

const lowestOpener = Math.ceil(CATALOGUE_FACTS.lowestEntry / 10) * 10;

const SLIDES: Slide[] = [
  {
    id: "vault",
    kicker: `${BRAND.full} · Est. ${BRAND.since}`,
    scene: <VaultScene />,
    headline: (
      <>
        You&apos;re inside the
        <br />
        <em>trade counter.</em>
      </>
    ),
    lede:
      "This is not a shop for shoppers. Everything past this point is priced for businesses that buy to sell on — so what you see is the price you pay, not the price you charge.",
    facts: [
      { value: group(CATALOGUE_FACTS.lines, 0), label: "Product lines, all in stock" },
      { value: multiple(CATALOGUE_FACTS.averageMarkup), label: "Average retail markup" },
      { value: "48h", label: "From order to dispatch" },
    ],
  },
  {
    id: "store",
    kicker: "What this place is for",
    scene: <StorefrontScene />,
    headline: (
      <>
        We stock it.
        <br />
        <em>You sell it.</em>
      </>
    ),
    lede:
      "Aurea is a wholesaler. We buy deep, hold it all in one warehouse, and sell it on to retailers, gift shops, salons, hotels and online sellers. Your margin is not a side effect of the business — it is the business.",
    bullets: [
      ["Trade-only pricing.", "Every price on the site is what you pay. Recommended retail sits beside it, so your margin is never a guess."],
      ["No franchise, no exclusivity, no fee.", "Take one carton or forty. There is nothing to sign and no territory to buy."],
      ["Own-brand ready.", "Most lines can carry your own label and packaging from a 500-unit run."],
    ],
  },
  {
    id: "gold",
    kicker: "Where the money is",
    scene: <GoldScene />,
    headline: (
      <>
        Buy at one price.
        <br />
        <em>Sell at another.</em>
      </>
    ),
    lede:
      "The average line here reaches your shelf at roughly a third of what it retails for. That gap is the whole trade — and it is printed on every product in the catalogue rather than worked out later on a spreadsheet.",
    facts: [
      { value: percent(CATALOGUE_FACTS.averageMargin), label: "Average gross margin on RRP" },
      { value: multiple(CATALOGUE_FACTS.averageMarkup), label: "Average markup, trade to retail" },
      { value: `${moneyRound(lowestOpener)}`, label: "Smallest opening line order" },
    ],
  },
  {
    id: "margin",
    kicker: "Volume does the rest",
    scene: <MarginScene />,
    headline: (
      <>
        The more you take,
        <br />
        the <em>less it costs.</em>
      </>
    ),
    lede:
      "Three volume breaks on every line, published on the product page rather than negotiated over a week of email. The cart applies them as you go, and tells you how close the next one is.",
    bullets: [
      ["4 cartons — 5% off trade.", "The point at which a trial order starts paying for itself."],
      ["10 cartons — 10% off trade.", "Where most established accounts sit across their core lines."],
      ["25 cartons — 16% off trade.", `Plus free carriage on everything over ${moneyRound(TERMS.freeShippingFrom)} and ${TERMS.netDays}-day terms once your account is approved.`],
    ],
  },
  {
    id: "shelf",
    kicker: "The range",
    scene: <ShelfScene />,
    headline: (
      <>
        {group(CATALOGUE_FACTS.lines, 0)} lines,
        <br />
        <em>chosen to sell.</em>
      </>
    ),
    lede:
      `Six categories — home, wellness, kitchen, tech, outdoor and gifting — held in one warehouse rather than drop-shipped from six. Every line carries its SKU, carton quantity, stock figure and lead time on the shelf edge.`,
    peek: true,
  },
  {
    id: "flow",
    kicker: "How ordering works",
    scene: <FlowScene />,
    headline: (
      <>
        Cart it, confirm it,
        <br />
        <em>it ships.</em>
      </>
    ),
    lede:
      "No minimum contract, no order form to email, no waiting on a rep to send a price list. The portal is the price list.",
    bullets: [
      ["Browse and add.", "Quantities step in whole cartons, so nothing you order can arrive broken up."],
      ["Confirm your account details.", "One screen. Your purchase order reference travels with the shipment and onto the invoice."],
      ["Dispatched from Copenhagen.", `Orders confirmed before ${TERMS.dispatchCutoff} leave the same working day.`],
    ],
  },
  {
    id: "warehouse",
    kicker: "Logistics",
    scene: <WarehouseScene />,
    headline: (
      <>
        One warehouse.
        <br />
        <em>Everything in it.</em>
      </>
    ),
    lede:
      "Stock figures on this site are live counts of what is on the racking, not a supplier's promise. If it says the units are there, they are there — and they are picked from one building, so a mixed order arrives as one delivery.",
    facts: [
      { value: group(CATALOGUE_FACTS.unitsInStock, 0), label: "Units on the racking right now" },
      { value: TERMS.dispatchCutoff, label: "Same-day dispatch cut-off" },
      { value: `${money(TERMS.shippingFlat, 0)}`, label: `Flat carriage under ${moneyRound(TERMS.freeShippingFrom)}` },
    ],
  },
  {
    id: "reach",
    kicker: "Reach",
    scene: <ReachScene />,
    headline: (
      <>
        Delivered anywhere
        <br />
        <em>in the EU.</em>
      </>
    ),
    lede:
      "Two to five working days across the union, VAT reverse-charged to your number, and one contact who knows your account rather than a ticket queue.",
    finale: true,
  },
];

const LAST = SLIDES.length - 1;
const clamp = (n: number) => Math.max(0, Math.min(LAST, n));
/** Smoothstep, clamped — an ease with no corners at either end. */
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function Intro({ onEnter }: { onEnter: () => void }) {
  const stage = useRef<HTMLElement | null>(null);

  // Where the film is, measured in slides. 2.4 means "two fifths of the way
  // out of slide three and into slide four", which is exactly what the two of
  // them need to know to cross-fade against each other.
  const [pos, setPos] = useState(0);
  const [touched, setTouched] = useState(false);
  const shown = useRef(0);
  const wanted = useRef(0);
  const frame = useRef(0);

  // Someone who has asked the operating system for less movement gets the
  // slides landed rather than glided. It can change while the page is open, so
  // it is subscribed to rather than read once.
  const reduceMotion = useSyncExternalStore(subscribeMotion, readMotion, readMotionOnServer);

  // Chase the wanted position instead of jumping to it: one notch of a mouse
  // wheel then arrives as a glide, and a hard trackpad flick decelerates into
  // place rather than skipping three slides on a single event.
  //
  // The decay is measured in milliseconds, not frames. Easing by a fixed
  // fraction per frame would make the glide twice as fast on a 120Hz screen as
  // on a 60Hz one, and crawl to a halt wherever the browser throttles
  // animation callbacks.
  const settle = useCallback(() => {
    if (frame.current) return;
    let previous = performance.now();

    const tick = (now: number) => {
      // Clamped, so returning to a stalled tab resumes the glide rather than
      // teleporting through the slides it missed.
      const dt = Math.min(64, now - previous);
      previous = now;

      const gap = wanted.current - shown.current;
      if (Math.abs(gap) < 0.0005) {
        shown.current = wanted.current;
        setPos(shown.current);
        frame.current = 0;
        return;
      }
      shown.current += gap * (1 - Math.pow(0.5, dt / GLIDE_HALF_LIFE));
      setPos(shown.current);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    []
  );

  const move = useCallback(
    (to: number) => {
      wanted.current = clamp(to);
      setTouched(true);
      if (reduceMotion) {
        // The wheel still accumulates in fractions — only what is drawn snaps,
        // so it still takes a slide's worth of scrolling to change slide.
        shown.current = Math.round(wanted.current);
        setPos(shown.current);
        return;
      }
      settle();
    },
    [reduceMotion, settle]
  );

  /** Scroll by a fraction of a slide. */
  const nudge = useCallback((by: number) => move(wanted.current + by), [move]);
  /** Jump a whole slide from wherever the scroll currently sits. */
  const step = useCallback((by: number) => move(Math.round(wanted.current) + by), [move]);

  // The wheel, the trackpad and the thumb. The film owns all three while it is
  // on screen: there is nothing behind it to scroll to, so letting the page
  // move underneath would only ever be a mistake.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;

    const pixels = (event: WheelEvent) => {
      if (event.deltaMode === 1) return event.deltaY * 16; // Firefox reports lines
      if (event.deltaMode === 2) return event.deltaY * window.innerHeight; // pages
      return event.deltaY;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpads report a horizontal component on a diagonal swipe; take
      // whichever axis the reader meant more of.
      const dy = pixels(event);
      const delta = Math.abs(event.deltaX) > Math.abs(dy) ? event.deltaX : dy;
      nudge(delta / SCROLL_PER_SLIDE);
    };

    let lastY = 0;
    const onTouchStart = (event: TouchEvent) => {
      lastY = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const y = event.touches[0].clientY;
      // A thumb travels a shorter distance than a wheel for the same intent.
      nudge((lastY - y) / (SCROLL_PER_SLIDE * 0.55));
      lastY = y;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [nudge]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          event.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          step(-1);
          break;
        case "Home":
          event.preventDefault();
          move(0);
          break;
        case "End":
          event.preventDefault();
          move(LAST);
          break;
        case "Escape":
          onEnter();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, step, onEnter]);

  // The pair currently on screen, and how far between them the reader is. The
  // outgoing slide is held at full strength underneath while the incoming one
  // fades in over it, so the dark field never shows through the seam.
  const base = Math.floor(pos);
  const frac = pos - base;
  const index = Math.round(pos);
  const fade = (i: number) => (i === base ? 1 : i === base + 1 ? frac : 0);

  // Type is handed over rather than dissolved. Two photographs can lie on top
  // of each other and still look like one picture; two paragraphs cannot — they
  // just look broken. So the outgoing words are gone by the time the incoming
  // ones start, and the artwork cross-fades through the gap on its own.
  const copyFade = (i: number) =>
    i === base ? 1 - smooth(frac / 0.42) : i === base + 1 ? smooth((frac - 0.58) / 0.42) : 0;

  return (
    <section
      className="au-intro"
      aria-label={`${BRAND.full} introduction`}
      aria-roledescription="carousel"
      ref={stage}
    >
      <div className="au-intro__stage">
        {SLIDES.map((slide, i) => {
          const opacity = fade(i);
          return (
          <article
            key={slide.id}
            className="au-slide"
            data-visible={opacity > 0}
            data-active={i === index}
            aria-hidden={i !== index}
            style={{ opacity, zIndex: i }}
          >
            <div className="au-slide__art">{slide.scene}</div>
            <div className="au-slide__scrim" />
            <div className="au-slide__body">
              <div className="au-slide__copy" style={{ opacity: copyFade(i) }}>
                <div className="au-kicker au-slide__kicker au-anim">{slide.kicker}</div>
                <h2 className="au-anim">{slide.headline}</h2>
                <p className="au-slide__lede au-anim">{slide.lede}</p>

                {slide.facts && (
                  <div className="au-facts au-anim">
                    {slide.facts.map((fact) => (
                      <div key={fact.label}>
                        <div className="au-fact__value">{fact.value}</div>
                        <div className="au-fact__label">{fact.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {slide.bullets && (
                  <ul className="au-bullets au-anim">
                    {slide.bullets.map(([lead, rest]) => (
                      <li key={lead}>
                        <span>
                          <strong>{lead}</strong> {rest}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {slide.peek && (
                  <>
                    <div className="au-peek au-anim">
                      {PEEK.map((product) => (
                        <div className="au-peek__tile" key={product.sku} title={product.name}>
                          <ProductArt art={product.art} tone={product.tone} />
                        </div>
                      ))}
                    </div>
                    <div className="au-facts au-anim">
                      <div>
                        <div className="au-fact__value">{group(PRODUCTS.length, 0)}</div>
                        <div className="au-fact__label">Lines in the catalogue</div>
                      </div>
                      <div>
                        <div className="au-fact__value">{CATALOGUE_FACTS.categories}</div>
                        <div className="au-fact__label">Categories</div>
                      </div>
                      <div>
                        <div className="au-fact__value">{group(CATALOGUE_FACTS.unitsInStock, 0)}</div>
                        <div className="au-fact__label">Units held in stock</div>
                      </div>
                    </div>
                  </>
                )}

                {slide.finale && (
                  <div className="au-intro__cta au-anim">
                    <button className="au-btn au-btn--gold" type="button" onClick={onEnter}>
                      Enter the shop <IconArrow />
                    </button>
                    <button className="au-btn au-btn--dark" type="button" onClick={() => move(0)}>
                      Watch again
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
          );
        })}
      </div>

      {/* Said once, then out of the way: it is only useful before the first
        * turn of the wheel, and patronising after it. */}
      <div className="au-scrollcue" data-gone={touched} aria-hidden="true">
        <span className="au-scrollcue__wheel">
          <i />
        </span>
        <span className="au-scrollcue__text">Scroll to play</span>
      </div>

      <header className="au-intro__top">
        <div className="au-wordmark" style={{ marginBottom: 0, maxWidth: 320, flex: 1 }}>
          <span className="au-wordmark__name" style={{ fontSize: 20 }}>
            {BRAND.name}
          </span>
          <span className="au-wordmark__rule" />
          <span className="au-wordmark__tag">{BRAND.kicker}</span>
        </div>
        <button className="au-btn au-btn--dark au-btn--sm" type="button" onClick={onEnter}>
          Skip to the shop <IconArrow size={14} />
        </button>
      </header>

      <div className="au-intro__bottom">
        <div className="au-dots" role="tablist" aria-label="Slides">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.id}
              className="au-dot"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}: ${slide.kicker}`}
              data-state={i < base ? "done" : i === base ? "active" : "todo"}
              style={i === base ? ({ "--au-progress": frac } as React.CSSProperties) : undefined}
              onClick={() => move(i)}
              type="button"
            >
              <span />
            </button>
          ))}
        </div>

        <div className="au-counter au-mono">
          {String(index + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
        </div>

        <div className="au-navbtns">
          <button
            className="au-iconbtn"
            type="button"
            onClick={() => step(-1)}
            disabled={pos < 0.02}
            aria-label="Previous slide"
          >
            <IconBack size={15} />
          </button>
          <button
            className="au-iconbtn"
            type="button"
            onClick={() => (pos > LAST - 0.02 ? onEnter() : step(1))}
            aria-label={pos > LAST - 0.02 ? "Enter the shop" : "Next slide"}
          >
            <IconArrow size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
