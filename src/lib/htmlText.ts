// Turning a web page into something readable.
//
// A modern page is mostly not the article: it's navigation, cookie banners,
// share buttons, a newsletter box, and three scripts for every paragraph. Hand
// all of that to a language model and you pay for it twice — once in tokens,
// once in the model losing the thread. So the page is cut down here, on the
// server, before Axis ever sees it.
//
// This is deliberately a small hand-written pass rather than a parser library.
// It has to survive broken markup without throwing, and it only ever produces
// text — nothing here executes, resolves, or fetches anything.

/** Blocks whose contents are never part of what you came to read. */
const DROPPED = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "head",
  "nav",
  "aside",
  "footer",
  "form",
  "button",
  "select",
];

/** Tags that end a line of prose. */
const BLOCK =
  /<\/?(?:p|div|section|article|main|header|ul|ol|li|dl|dt|dd|table|tr|blockquote|pre|figure|figcaption|h[1-6])\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  deg: "°",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  oslash: "ø",
  aring: "å",
  aelig: "æ",
  szlig: "ß",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  times: "×",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Control characters and out-of-range points come back as themselves
      // rather than as something invisible in the middle of a sentence.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function stripTag(html: string, tag: string): string {
  // Non-greedy, case-insensitive, and tolerant of an unclosed tag at the end
  // of a truncated page — which is common, since pages get cut off.
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const dangling = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "i");
  return html.replace(paired, " ").replace(dangling, " ");
}

/** The page's own title, before the rest of it is taken apart. */
export function pageTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? collapse(decodeEntities(stripTags(match[1]))) : "";
  return title || undefined;
}

/** The summary the page publishes about itself, when it has one. */
export function pageDescription(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      const text = collapse(decodeEntities(match[1]));
      if (text) return text;
    }
  }
  return undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function collapse(text: string): string {
  return (
    text
      .replace(/[ \t\u00a0]+/g, " ")
      // Inline markup becomes a space, so "<b>Europe</b>." arrives as
      // "Europe ." — which reads as a typo in every sentence on the page.
      .replace(/\s+([,.;:!?%)\]}])/g, "$1")
      .replace(/([([{])\s+/g, "$1")
      .trim()
  );
}

/**
 * Narrow to the part of the page that is the actual content, when the page
 * says where that is. Most publishing software marks it, and the difference
 * between <article> and the whole document is usually a factor of ten.
 */
function mainContent(html: string): string {
  for (const tag of ["article", "main"]) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(html);
    // A sliver of content means the tag was used for something else (a card,
    // a teaser), so only take it when there's a real body of text in it.
    if (match && match[1].length > 600) return match[1];
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  return body ? body[1] : html;
}

export interface ExtractedPage {
  title?: string;
  description?: string;
  text: string;
  /** True when the page was longer than the budget and has been cut. */
  truncated: boolean;
}

/**
 * Pull the readable text out of an HTML document.
 *
 * `limit` is a character budget, not a promise about tokens — it exists so one
 * enormous page can't eat the whole context window and push the conversation
 * out of it.
 */
export function extractReadable(html: string, limit = 8000): ExtractedPage {
  const title = pageTitle(html);
  const description = pageDescription(html);

  let working = html.replace(/<!--[\s\S]*?-->/g, " ");
  working = mainContent(working);
  for (const tag of DROPPED) working = stripTag(working, tag);

  working = working
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(BLOCK, "\n");

  let text = decodeEntities(stripTags(working));

  text = text
    .split("\n")
    .map((line) => collapse(line))
    // A line that is only a bullet marker is a list item whose text was in a
    // dropped element — a menu, usually.
    .filter((line) => line && line !== "-")
    .join("\n")
    // Runs of blank lines are what's left of the page furniture.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const truncated = text.length > limit;
  if (truncated) {
    // Cut at a sentence or line end where one is near, so the last thing read
    // isn't half a word.
    const cut = text.slice(0, limit);
    const stop = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
    text = (stop > limit * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }

  return { title, description, text, truncated };
}
