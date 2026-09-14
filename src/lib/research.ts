import { readPage, searchWeb, type SearchHit } from "./web";

// Studying something properly, rather than searching once and paraphrasing the
// first result.
//
// One search is not research. The difference, in practice, is four things:
//
//   1. ASKING MORE THAN ONE QUESTION. A single phrasing finds a single corner
//      of the web. Three phrasings of the same question find the corners that
//      disagree with each other, which is where the answer actually is.
//   2. NOT TAKING FIVE ANSWERS FROM ONE SITE. Five pages from one domain are
//      one source repeated, and they will agree with each other whether or not
//      they are right.
//   3. READING THE PAGES. A search snippet is written to be clicked. What the
//      page says two paragraphs in is frequently not what the snippet implies.
//   4. NOTICING WHEN SOURCES DISAGREE, and saying so, rather than quietly
//      picking whichever one reads better.
//
// What this does NOT do is write the answer. It gathers, numbers and quotes,
// and hands that to the model to write from — so every sentence in the reply
// can point at a source, and a claim with no source behind it is visibly a
// claim with no source behind it.

/** How many pages to actually open, at each depth. */
const PAGES: Record<ResearchDepth, number> = { quick: 3, normal: 5, deep: 8 };
/** How many distinct sites must be represented before we stop caring. */
const MIN_DOMAINS: Record<ResearchDepth, number> = { quick: 2, normal: 3, deep: 5 };
/** Characters of each page to pull down. */
const PAGE_BUDGET = 6000;
/** Passages kept per page. */
const PASSAGES_PER_PAGE = 3;

export type ResearchDepth = "quick" | "normal" | "deep";

export interface ResearchSource {
  /** 1-based, so the model can cite [1] and mean this. */
  ref: number;
  title: string;
  url: string;
  site: string;
  /** Whether the page itself was opened, or only its search snippet seen. */
  read: boolean;
}

export interface ResearchPassage {
  /** Which source it came from. */
  ref: number;
  text: string;
}

export interface ResearchReport {
  question: string;
  /** Every phrasing actually searched. */
  queries: string[];
  sources: ResearchSource[];
  passages: ResearchPassage[];
  /** Where the sources contradict each other on a number. */
  conflicts: string[];
  cautions: string[];
  note: string;
}

/**
 * Several ways of asking the same thing.
 *
 * A question typed by a person is one phrasing, and a search engine answers
 * phrasings rather than questions. Adding a plain-noun version and a
 * comparison version reaches pages the original wording never would.
 */
export function queryVariants(question: string, depth: ResearchDepth): string[] {
  const base = question.trim().replace(/\s+/g, " ");
  const stripped = base
    .replace(/^(what|who|when|where|why|how|is|are|do|does|can|could|should|will)\b\s*/i, "")
    .replace(/\?+$/, "")
    .trim();

  const variants = [base];
  if (stripped && stripped.toLowerCase() !== base.toLowerCase()) variants.push(stripped);
  if (depth !== "quick") {
    // The two shapes that most often find the disagreement.
    variants.push(`${stripped || base} explained`);
    if (depth === "deep") variants.push(`${stripped || base} problems OR criticism OR limitations`);
  }
  return variants.slice(0, depth === "deep" ? 4 : depth === "normal" ? 3 : 1);
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Pick what to read: the best results, but spread across sites.
 *
 * Taking the top N outright routinely gives five pages from one domain, which
 * is one source wearing five hats. So the first pass takes at most one page
 * per site, and only once every site has been represented does it come back
 * for seconds.
 */
export function spreadAcrossSites(hits: SearchHit[], want: number): SearchHit[] {
  const seenUrl = new Set<string>();
  const unique = hits.filter((hit) => {
    const key = hit.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seenUrl.has(key)) return false;
    seenUrl.add(key);
    return true;
  });

  const picked: SearchHit[] = [];
  const usedSites = new Set<string>();

  for (const hit of unique) {
    if (picked.length >= want) break;
    const site = siteOf(hit.url);
    if (usedSites.has(site)) continue;
    usedSites.add(site);
    picked.push(hit);
  }
  for (const hit of unique) {
    if (picked.length >= want) break;
    if (!picked.includes(hit)) picked.push(hit);
  }
  return picked;
}

/**
 * The parts of a page that bear on the question.
 *
 * Scored by how many of the question's own words a paragraph contains, which
 * is crude and works: the paragraph that answers a question nearly always
 * repeats its nouns. Very short lines are dropped — they are navigation,
 * cookie notices and image captions.
 */
export function relevantPassages(text: string, question: string, keep = PASSAGES_PER_PAGE): string[] {
  const wanted = new Set(
    question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );
  if (wanted.size === 0) return [];

  const paragraphs = text
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 80 && line.length <= 1200);

  const scored = paragraphs.map((paragraph) => {
    const words = paragraph.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
    const hits = new Set(words.filter((word) => wanted.has(word)));
    // Favour a paragraph that mentions several DIFFERENT wanted words over one
    // that repeats a single one twenty times, which is usually a tag cloud.
    return { paragraph, score: hits.size + (/\d/.test(paragraph) ? 0.5 : 0) };
  });

  return scored
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .map((entry) => entry.paragraph);
}

/** Numbers with units or percentages, which are the claims that can clash. */
function figuresIn(text: string): string[] {
  // Broad on purpose. A short list looks tidy and quietly misses the
  // disagreement it exists to find — "450 hp" against "400 hp" went unnoticed
  // until a test asked for it.
  return [...text.matchAll(
    /\b\d[\d,.]*\s?(?:%|percent|pct|million|billion|thousand|k|m|bn|kr|kroner|dkk|usd|eur|gbp|dollars?|euros?|pounds?|hp|bhp|kw|w|v|a|nm|mph|km\/h|kmh|kb|mb|gb|tb|mm|cm|km|m|kg|g|lbs?|mpa|psi|ghz|mhz|fps|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?)\b/gi
  )]
    .map((hit) => hit[0].toLowerCase().replace(/\s+/g, " "))
    .slice(0, 40);
}

/**
 * Where two sources put a different number on the same thing.
 *
 * Deliberately reported rather than resolved. Picking one and saying it
 * confidently is how a research tool launders a guess into a fact; naming the
 * disagreement is the honest output, and it is usually the most useful
 * sentence in the whole report.
 */
export function findConflicts(passages: ResearchPassage[]): string[] {
  const byUnit = new Map<string, Map<string, Set<number>>>();

  for (const passage of passages) {
    for (const figure of figuresIn(passage.text)) {
      const unit = figure.replace(/^[\d,. ]+/, "").trim();
      const value = figure.replace(/[^\d,.]/g, "").replace(/[,.]$/, "");
      if (!unit || !value) continue;
      if (!byUnit.has(unit)) byUnit.set(unit, new Map());
      const values = byUnit.get(unit)!;
      if (!values.has(value)) values.set(value, new Set());
      values.get(value)!.add(passage.ref);
    }
  }

  const conflicts: string[] = [];
  for (const [unit, values] of byUnit) {
    if (values.size < 2) continue;
    // Only worth reporting when the clashing figures come from different
    // sources — one page giving two numbers is usually two different things.
    const refs = new Set<number>();
    for (const set of values.values()) for (const ref of set) refs.add(ref);
    if (refs.size < 2) continue;

    const described = [...values.entries()]
      .slice(0, 4)
      .map(([value, sourceRefs]) => `${value} ${unit} [${[...sourceRefs].join(", ")}]`)
      .join(" vs ");
    conflicts.push(`Sources disagree on a figure in ${unit}: ${described}`);
    if (conflicts.length >= 4) break;
  }
  return conflicts;
}

export interface ResearchParams {
  question: string;
  depth?: ResearchDepth;
}

export async function research(params: ResearchParams): Promise<ResearchReport> {
  const question = params.question.trim();
  if (!question) throw new Error("What would you like me to look into, sir?");
  const depth = params.depth ?? "normal";

  const queries = queryVariants(question, depth);

  // Searches run together; they do not depend on one another.
  const outcomes = await Promise.all(
    queries.map((query) => searchWeb(query, 8).catch(() => null))
  );

  const hits: SearchHit[] = [];
  for (const outcome of outcomes) if (outcome) hits.push(...outcome.results);

  if (hits.length === 0) {
    throw new Error(
      "The web search came back with nothing at all, sir — which usually means the search key isn't set, rather than that nothing exists."
    );
  }

  const chosen = spreadAcrossSites(hits, PAGES[depth]);

  const sources: ResearchSource[] = chosen.map((hit, index) => ({
    ref: index + 1,
    title: hit.title,
    url: hit.url,
    site: siteOf(hit.url),
    read: false,
  }));

  // Read them all at once. One at a time turns eight pages into half a minute.
  const pages = await Promise.all(
    chosen.map((hit) => readPage(hit.url, PAGE_BUDGET).catch(() => null))
  );

  const passages: ResearchPassage[] = [];
  pages.forEach((page, index) => {
    const source = sources[index];
    if (!page) {
      // A snippet is still something, and saying which pages would not open is
      // part of an honest report.
      const snippet = chosen[index].snippet?.trim();
      if (snippet) passages.push({ ref: source.ref, text: snippet });
      return;
    }
    source.read = true;
    const found = relevantPassages(page.text, question);
    for (const text of found) passages.push({ ref: source.ref, text });
    if (found.length === 0 && chosen[index].snippet) {
      passages.push({ ref: source.ref, text: chosen[index].snippet!.trim() });
    }
  });

  const conflicts = findConflicts(passages);

  const readCount = sources.filter((source) => source.read).length;
  const siteCount = new Set(sources.map((source) => source.site)).size;

  const cautions: string[] = [];
  if (siteCount < MIN_DOMAINS[depth]) {
    cautions.push(
      `Only ${siteCount} different site${siteCount === 1 ? "" : "s"} could be reached, so this is narrower than it looks.`
    );
  }
  if (readCount < sources.length) {
    cautions.push(
      `${sources.length - readCount} of ${sources.length} pages wouldn't open; those are search snippets only.`
    );
  }
  if (passages.length === 0) {
    cautions.push("Nothing on any page matched the question closely enough to quote.");
  }
  cautions.push("Everything below is what web pages say, not what I know to be true.");

  return {
    question,
    queries,
    sources,
    passages,
    conflicts,
    cautions,
    note:
      `Searched ${queries.length} way${queries.length === 1 ? "" : "s"}, read ${readCount} of ` +
      `${sources.length} pages across ${siteCount} site${siteCount === 1 ? "" : "s"}` +
      (conflicts.length ? `, and they disagree on ${conflicts.length} figure${conflicts.length === 1 ? "" : "s"}.` : "."),
  };
}
