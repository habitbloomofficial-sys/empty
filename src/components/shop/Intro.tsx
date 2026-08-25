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
import { IconArrow, IconBack, IconPause, IconPlay } from "./Icons";

/*
 * The introduction.
 *
 * A buyer arriving here has been handed a code by a salesperson and has no idea
 * what the range is, what the margins look like, or how ordering works. Rather
 * than drop them into a grid of thirty unfamiliar products, this walks them
 * through it once — eight slides, about a minute — and then gets out of the way
 * for good. It runs on arrival and never again unless asked for by name.
 *
 * Everything numeric on these slides is computed from the catalogue, so the
 * pitch cannot drift out of step with the products behind it.
 */

const SLIDE_MS = 9000;

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

export function Intro({ onEnter }: { onEnter: () => void }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number>(0);
  const elapsed = useRef<number>(0);

  // Someone who has asked for less motion should not have slides moving under
  // them unprompted — but pressing play is a request, so an explicit choice
  // outranks the preference in both directions.
  const reduceMotion = useSyncExternalStore(subscribeMotion, readMotion, readMotionOnServer);
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduceMotion;
  const setPlaying = useCallback(
    (next: boolean | ((current: boolean) => boolean)) =>
      setChoice((current) => {
        const now = current ?? !readMotion();
        return typeof next === "function" ? next(now) : next;
      }),
    []
  );

  const go = useCallback((next: number) => {
    setIndex((current) => {
      const target = Math.max(0, Math.min(SLIDES.length - 1, next));
      if (target !== current) {
        elapsed.current = 0;
        setProgress(0);
      }
      return target;
    });
  }, []);

  // One rAF loop drives both the progress bar and the advance, so the bar can
  // never finish at a different moment than the slide it belongs to.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    startedAt.current = performance.now() - elapsed.current;

    const tick = (now: number) => {
      const spent = now - startedAt.current;
      elapsed.current = spent;
      const ratio = Math.min(1, spent / SLIDE_MS);
      setProgress(ratio);
      if (ratio >= 1) {
        elapsed.current = 0;
        if (index >= SLIDES.length - 1) {
          setPlaying(false);
          setProgress(1);
          return;
        }
        setIndex((current) => current + 1);
        setProgress(0);
        startedAt.current = now;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, index, setPlaying]);

  // Pause while the tab is in the background rather than racing through the
  // deck to the last slide unseen.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [setPlaying]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key === "Escape") onEnter();
      else if (event.key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onEnter, setPlaying]);

  return (
    <section className="au-intro" aria-label={`${BRAND.full} introduction`}>
      <div className="au-intro__stage">
        {SLIDES.map((slide, i) => (
          <article key={slide.id} className="au-slide" data-active={i === index} aria-hidden={i !== index}>
            <div className="au-slide__art">{slide.scene}</div>
            <div className="au-slide__scrim" />
            <div className="au-slide__body">
              <div className="au-slide__copy">
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
                    <button className="au-btn au-btn--dark" type="button" onClick={() => go(0)}>
                      Watch again
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
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
              data-state={i < index ? "done" : i === index ? "active" : "todo"}
              style={i === index ? ({ "--au-progress": progress } as React.CSSProperties) : undefined}
              onClick={() => go(i)}
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
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button
            className="au-iconbtn"
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous slide"
          >
            <IconBack size={15} />
          </button>
          <button
            className="au-iconbtn"
            type="button"
            onClick={() => (index === SLIDES.length - 1 ? onEnter() : go(index + 1))}
            aria-label={index === SLIDES.length - 1 ? "Enter the shop" : "Next slide"}
          >
            <IconArrow size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
