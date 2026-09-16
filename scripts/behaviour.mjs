// The decisions, exercised.
//
// tsc proves the types line up and eslint proves the style does. Neither runs
// a single line. What is checked here is the handful of places where being
// wrong is silent — where the code compiles, lints, launches, and quietly does
// the wrong thing, which is the only kind of bug that survives to reach him.
//
// Run by `npm run verify`. Add to it when something breaks in a way nothing
// caught.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const done = [];
const failures = [];

async function check(what, body) {
  try {
    await body();
    done.push(what);
  } catch (error) {
    failures.push(`${what}\n      ${error.message.split("\n")[0]}`);
  }
}

/** Read a settings file, run something, put the old one back whatever happens. */
async function withSettings(values, body) {
  const file = path.join("data", "settings.json");
  fs.mkdirSync("data", { recursive: true });
  const had = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
  try {
    fs.writeFileSync(file, JSON.stringify(values));
    return await body();
  } finally {
    if (had !== null) fs.writeFileSync(file, had);
    else fs.rmSync(file, { force: true });
  }
}

// --- opening several pages at once -----------------------------------------

const desktop = await import("../src/lib/desktop.ts");

await check("Chromium takes several URLs as bare arguments", () => {
  const urls = ["https://a.example", "https://b.example", "https://c.example"];
  for (const browser of ["chrome", "edge", "opera", "brave"]) {
    assert.deepEqual(desktop.tabArguments(browser, urls), urls, browser);
  }
});

await check("Firefox gets -new-tab before every page after the first", () => {
  // Without this Firefox opens the FIRST url and silently drops the rest, so
  // "open my six morning tabs" opens one and nothing says why.
  const urls = ["https://a.example", "https://b.example", "https://c.example"];
  assert.deepEqual(desktop.tabArguments("firefox", urls), [
    "https://a.example",
    "-new-tab",
    "https://b.example",
    "-new-tab",
    "https://c.example",
  ]);
  assert.deepEqual(desktop.tabArguments("firefox", ["https://a.example"]), ["https://a.example"]);
});

await check("no page is lost by either browser's syntax", () => {
  const urls = ["https://a.example", "https://b.example", "https://c.example"];
  for (const browser of ["chrome", "firefox"]) {
    const kept = desktop.tabArguments(browser, urls).filter((arg) => arg.startsWith("https://"));
    assert.equal(kept.length, urls.length, browser);
  }
});

await check("named sites resolve to the site, not a search for its name", () => {
  assert.equal(desktop.resolveWebsiteTarget({ site: "gmail" }).searched, false);
  assert.match(desktop.resolveWebsiteTarget({ site: "chat gpt" }).target, /chatgpt\.com/);
  for (const said of ["shopify", "my shop", "my store", "shopify admin"]) {
    const found = desktop.resolveWebsiteTarget({ site: said });
    assert.match(found.target, /admin\.shopify\.com/, said);
    assert.equal(found.searched, false, said);
  }
});

await check("a name we don't know is searched for, never guessed into a domain", () => {
  // Guessing at a domain is how you land on somebody's parked typo.
  assert.equal(desktop.resolveWebsiteTarget({ site: "casper's thing" }).searched, true);
});

// --- saved sets of tabs -----------------------------------------------------

const workspaces = await import("../src/lib/workspaces.ts");
const STORE = path.join("data", "workspaces.json");

await check("workspace names match the way he says them", () => {
  const had = fs.existsSync(STORE) ? fs.readFileSync(STORE, "utf-8") : null;
  try {
    fs.rmSync(STORE, { force: true });
    workspaces.saveWorkspace("Morning", [{ site: "gmail" }, { site: "google calendar" }]);
    for (const said of ["morning", "my morning", "the morning", "morning tabs", "my morning setup"]) {
      assert.equal(workspaces.findWorkspace(said)?.name, "Morning", said);
    }
    assert.equal(workspaces.findWorkspace("evening"), null, "no false match");

    // Saving over a name replaces it rather than making a second one.
    workspaces.saveWorkspace("morning", [{ site: "outlook" }]);
    assert.equal(workspaces.listWorkspaces().length, 1);
    assert.equal(workspaces.findWorkspace("Morning").pages[0].site, "outlook");

    assert.throws(() => workspaces.saveWorkspace("", [{ site: "x" }]), /needs a name/);
    assert.throws(() => workspaces.saveWorkspace("x", []), /at least one page/);
    assert.throws(
      () => workspaces.saveWorkspace("x", Array.from({ length: 16 }, () => ({ site: "y" }))),
      /up to that many/
    );
  } finally {
    fs.rmSync(STORE, { force: true });
    if (had !== null) fs.writeFileSync(STORE, had);
  }
});

await check("a damaged workspaces.json degrades quietly", () => {
  const had = fs.existsSync(STORE) ? fs.readFileSync(STORE, "utf-8") : null;
  try {
    fs.writeFileSync(STORE, "{ not json at all");
    assert.deepEqual(workspaces.listWorkspaces(), []);
    fs.writeFileSync(STORE, JSON.stringify([{ junk: 1 }, { name: "ok", pages: [] }]));
    assert.deepEqual(workspaces.listWorkspaces().map((w) => w.name), ["ok"]);
  } finally {
    fs.rmSync(STORE, { force: true });
    if (had !== null) fs.writeFileSync(STORE, had);
  }
});

// --- the shop ---------------------------------------------------------------

await check("the store address normalises from every form he might paste", async () => {
  const cases = [
    ["casper-shop", "casper-shop.myshopify.com"],
    ["casper-shop.myshopify.com", "casper-shop.myshopify.com"],
    ["https://casper-shop.myshopify.com", "casper-shop.myshopify.com"],
    ["https://casper-shop.myshopify.com/admin/orders", "casper-shop.myshopify.com"],
    ["HTTPS://Casper-Shop.MyShopify.com/", "casper-shop.myshopify.com"],
    // A custom domain cannot authenticate, so it is refused rather than tried.
    ["shop.casper.dk", null],
    ["", null],
  ];
  for (const [written, expected] of cases) {
    await withSettings({ SHOPIFY_STORE: written }, async () => {
      const shopify = await import(`../src/lib/shopify.ts?case=${encodeURIComponent(written)}`);
      assert.equal(shopify.storeHost(), expected, `"${written}"`);
    });
  }
});

await check("a store with no token says so rather than failing at Shopify", async () => {
  await withSettings({ SHOPIFY_STORE: "s.myshopify.com" }, async () => {
    const shopify = await import(`../src/lib/shopify.ts?case=notoken`);
    assert.equal(shopify.isShopifyConfigured(), false);
    await assert.rejects(() => shopify.shopInfo(), /isn't connected yet/);
  });
});

await check("the shop is read-only by construction", async () => {
  // Not a matter of intent: there must be no mutation in the file at all.
  const source = fs.readFileSync(path.join("src", "lib", "shopify.ts"), "utf-8");
  assert.ok(!/\bmutation\b/i.test(source), "shopify.ts contains a GraphQL mutation");
  for (const forbidden of ["orderClose", "refundCreate", "orderCancel", "productUpdate"]) {
    assert.ok(!source.includes(forbidden), `shopify.ts references ${forbidden}`);
  }
});

// --- moving windows ---------------------------------------------------------

await check("nothing can close a window", async () => {
  // A window holds unsaved work and closing it has no undo. The guarantee is
  // that the capability is absent, not that it is used carefully.
  const source = fs.readFileSync(path.join("src", "lib", "windowControl.ts"), "utf-8");
  assert.ok(!/\bCloseMainWindow\b|\bStop-Process\b|\btaskkill\b/i.test(source));
  const control = await import("../src/lib/windowControl.ts");
  assert.ok(!Object.keys(control).some((name) => /close|kill|quit/i.test(name)));
});

await check("a window title never reaches PowerShell as script text", () => {
  // Titles come from web pages, emails and file names. They travel as an
  // environment variable, read back as data, so punctuation stays punctuation.
  const source = fs.readFileSync(path.join("src", "lib", "windowControl.ts"), "utf-8");
  assert.ok(source.includes("$env:JARVIS_WINDOW_PID"), "focus goes through the environment");

  // Only the scripts matter. A template literal in a sentence he reads is not
  // a script, so the check reads the argument to powershell() rather than
  // every backtick in the file.
  const scripts = [...source.matchAll(/powershell\(\s*`([^`]*)`/g)].map((hit) => hit[1]);
  assert.ok(scripts.length > 0, "no powershell() template found — has the shape changed?");
  for (const script of scripts) {
    for (const found of script.match(/\$\{[^}]+\}/g) ?? []) {
      assert.ok(
        found.includes("SHELL_METHOD"),
        `a script interpolates ${found}, which is not the fixed method table`
      );
    }
  }
});

// --- the PDF, written by hand ----------------------------------------------

const pdf = await import("../src/lib/pdf.ts");

await check("a guide is a structurally valid PDF", () => {
  const file = pdf.renderPdf({
    title: "A plan",
    subtitle: "For something",
    sections: [{ heading: "One", paragraphs: ["Some prose."], bullets: ["A point"] }],
    footer: "Jarvis",
  });
  const text = file.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "no PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "no EOF marker");

  // The xref table is where a hand-written PDF actually breaks: every entry is
  // a byte offset, and a reader that finds the wrong byte there opens nothing.
  const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
  assert.ok(Number.isFinite(startxref), "no startxref");
  assert.equal(text.slice(startxref, startxref + 4), "xref", "startxref points at the wrong byte");

  const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((hit) => Number(hit[1]));
  assert.ok(offsets.length >= 5, `only ${offsets.length} objects in the xref`);
  for (const [index, at] of offsets.entries()) {
    assert.match(
      text.slice(at, at + 24),
      /^\d+ 0 obj/,
      `xref entry ${index} points at "${text.slice(at, at + 16)}" rather than an object`
    );
  }
});

await check("every /Length matches the stream it describes", () => {
  // Declare the wrong length and a reader stops mid-page, usually silently.
  const file = pdf
    .renderPdf({
      title: "Lengths",
      sections: [{ paragraphs: ["Text with (brackets) and a backslash \\ in it."] }],
    })
    .toString("latin1");
  const streams = [...file.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
  assert.ok(streams.length > 0, "no streams found");
  for (const [, declared, body] of streams) {
    assert.equal(Buffer.byteLength(body, "latin1"), Number(declared), "declared length is wrong");
  }
});

await check("typographic characters survive as WinAnsi, not as holes", () => {
  // latin1 has no em dash or bullet. Written naively they vanish from the page,
  // and a dash always sits exactly where the sentence turns.
  const file = pdf
    .renderPdf({ title: "Dashes \u2014 and \u2019quotes\u2019", sections: [{ bullets: ["A point"] }] })
    .toString("latin1");
  assert.ok(file.includes("\\227"), "em dash did not become its WinAnsi byte");
  assert.ok(file.includes("\\222"), "curly apostrophe did not become its WinAnsi byte");
  assert.ok(file.includes("\\225"), "bullet glyph did not become its WinAnsi byte");
});

await check("wrapping fits the page, and never breaks a long URL", () => {
  const lines = pdf.wrap("the quick brown fox jumps over the lazy dog ".repeat(20), "regular", 11);
  assert.ok(lines.length > 5, "did not wrap at all");

  const url = "https://example.com/" + "a/".repeat(80);
  const kept = pdf.wrap(`See ${url} for more`, "regular", 11);
  assert.ok(kept.some((line) => line.includes(url)), "a long URL was broken across lines");
});

// --- what the model sends reaching what writes the file ---------------------

const { executeTool } = await import("../src/lib/tools.ts");

await check("a guide's steps reach the page", async () => {
  // This is the shape of the bug that was found: the schema declared fields,
  // the writer used them, and the dispatch between the two quietly dropped
  // them — so decks came out as plain bullets and no chart was ever drawn.
  const out = await executeTool(
    "create_document",
    JSON.stringify({
      kind: "guide",
      title: "Learning something",
      sections: [
        {
          heading: "Week one",
          steps: [
            { marker: "Day 1", title: "Do the first thing.", detail: "And here is how." },
            { title: "A step with no marker still counts." },
            { marker: "Day 3", detail: "No title, so this one is dropped." },
          ],
        },
      ],
    })
  );
  const made = out.result;
  try {
    const text = fs.readFileSync(made.path).toString("latin1");
    assert.ok(text.includes("Day 1"), "step marker missing from the PDF");
    assert.ok(text.includes("Do the first thing."), "step title missing");
    assert.ok(text.includes("And here is how."), "step detail missing");
    assert.ok(!text.includes("Day 3"), "a step with no title should be dropped");
    assert.match(made.size, /step/, `size should mention steps, said "${made.size}"`);
  } finally {
    fs.rmSync(made.path, { force: true });
  }
});

await check("figures are coerced, and the unusable ones dropped", async () => {
  const out = await executeTool(
    "create_document",
    JSON.stringify({
      kind: "guide",
      title: "Figures",
      sections: [
        {
          heading: "Numbers",
          // A model sends a number as a string often enough to matter.
          figures: [
            { label: "Direct", value: 42 },
            { label: "Search", value: "27" },
            { label: "Broken", value: "not a number" },
            { value: 9 },
          ],
        },
      ],
    })
  );
  const made = out.result;
  try {
    const text = fs.readFileSync(made.path).toString("latin1");
    // A guide does not draw charts, but NaN must never reach the file either way.
    assert.ok(!text.includes("NaN"), "NaN leaked into a document");
  } finally {
    fs.rmSync(made.path, { force: true });
  }
});

// --- ringing him ------------------------------------------------------------

await check("a spoken update is refused when it is too long to hear", async () => {
  const phone = await import("../src/lib/phone.ts");
  await assert.rejects(() => phone.callWithUpdate(""), /nothing to tell you/);
  await assert.rejects(
    () => phone.callWithUpdate("word ".repeat(400)),
    /short version/,
    "an essay down the telephone should be refused"
  );
  assert.ok(phone.MAX_SPOKEN_UPDATE <= 1500, "spoken cap is longer than anyone listens");
});

// --- knowing when he is talking to you --------------------------------------

const addressed = await import("../src/lib/addressed.ts");

await check("he answers a plain instruction without being named", () => {
  for (const said of [
    "open my morning tabs",
    "play the new trailer",
    "remind me to call the dentist",
    "can you check my shopify orders",
    "what's the trending video right now",
    "åbn min mail",
    "kan du finde den video",
  ]) {
    const verdict = addressed.isAddressedToJarvis(said, {});
    assert.ok(verdict.addressed, `stayed silent for "${said}" (${verdict.confidence})`);
  }
});

await check("a follow-up mid-conversation needs no name", () => {
  const talking = { conversationOpen: true, sinceLastExchangeMs: 5_000 };
  for (const said of ["no, the other one", "turn it up a bit", "yeah do that"]) {
    assert.ok(addressed.isAddressedToJarvis(said, talking).addressed, said);
  }
  // …but the same words long afterwards start nothing.
  const cold = { conversationOpen: true, sinceLastExchangeMs: 20 * 60_000 };
  assert.equal(addressed.isAddressedToJarvis("no, the other one", cold).addressed, false);
});

await check("he stays out of speech that is not aimed at him", () => {
  const cases = [
    ["he said the trailer drops on friday", {}],
    ["mum, can you pass me the remote", {}],
    ["my assistant can do that now", {}],
    ["yeah", {}],
    ["haha", { conversationOpen: true, sinceLastExchangeMs: 3_000 }],
    [
      "so anyway I was telling him about the thing that happened at work last week and honestly it was the strangest situation I have ever been in with a client",
      {},
    ],
  ];
  for (const [said, ctx] of cases) {
    const verdict = addressed.isAddressedToJarvis(said, ctx);
    assert.equal(verdict.addressed, false, `answered "${said}" (${verdict.confidence})`);
  }
});

await check("saying his name is not the same as speaking to him", () => {
  // The most embarrassing possible failure: butting into a remark about you.
  const verdict = addressed.isAddressedToJarvis("jarvis is really good at this actually", {});
  assert.equal(verdict.addressed, false, "answered a remark about himself");
  assert.ok(verdict.namedHim, "should still notice the name was said");
  // But a question that happens to start the same way IS for him.
  assert.ok(addressed.isAddressedToJarvis("jarvis is that the right one", {}).addressed);
});

await check("name-only mode still works for anyone who wants it", () => {
  const strict = { mode: "name" };
  assert.equal(addressed.isAddressedToJarvis("open my email", strict).addressed, false);
  assert.ok(addressed.isAddressedToJarvis("hey jarvis open my email", strict).addressed);
  // Standby means the name and nothing else, whatever the mode.
  assert.equal(
    addressed.isAddressedToJarvis("open my email", { standby: true }).addressed,
    false
  );
});

// --- studying something -----------------------------------------------------

const researchLib = await import("../src/lib/research.ts");

await check("research asks more than one question", () => {
  const deep = researchLib.queryVariants("what is the best filament for outdoor parts?", "deep");
  assert.ok(deep.length >= 3, `only ${deep.length} phrasings`);
  // One of them must go looking for the downside, or it is an echo chamber.
  assert.ok(deep.some((query) => /problem|criticism|limitation/i.test(query)));
  assert.equal(researchLib.queryVariants("anything", "quick").length, 1);
});

await check("research spreads across sites rather than mining one", () => {
  const hits = [
    { title: "a", url: "https://one.com/a" },
    { title: "b", url: "https://one.com/b" },
    { title: "c", url: "https://one.com/c" },
    { title: "d", url: "https://two.com/a" },
    { title: "e", url: "https://three.com/a" },
  ];
  const picked = researchLib.spreadAcrossSites(hits, 3);
  const sites = new Set(picked.map((hit) => new URL(hit.url).hostname));
  assert.equal(sites.size, 3, "took more than one page from a single site first");
});

await check("research reports disagreement instead of picking a side", () => {
  const conflicts = researchLib.findConflicts([
    { ref: 1, text: "The engine makes 450 hp according to the manufacturer." },
    { ref: 2, text: "Independent testing put it at 400 hp on the day." },
  ]);
  assert.ok(conflicts.length >= 1, "did not notice two sources giving different figures");
  assert.match(conflicts[0], /disagree/i);
});

await check("research keeps only passages that bear on the question", () => {
  const page = [
    "Accept cookies to continue browsing this website today.",
    "The layer bond in a printed part is typically half the strength of the plastic along the layers, which is why print orientation matters more than infill for a bracket carrying a load.",
    "Sign up to our newsletter.",
  ].join("\n");
  const kept = researchLib.relevantPassages(page, "does print orientation affect layer strength", 3);
  assert.equal(kept.length, 1, `kept ${kept.length} passages`);
  assert.match(kept[0], /layer bond/);
});

// --- the engineering ---------------------------------------------------------

const printing = await import("../src/lib/printing.ts");
const engineer = await import("../src/lib/engineer.ts");
const { stressTest } = await import("../src/lib/stress.ts");
const { MATERIALS } = await import("../src/lib/loadCalc.ts");
const { box } = await import("../src/lib/solids.ts");

await check("print orientation changes the answer by the layer-bond factor", () => {
  // The single biggest error in any printed-part sum that ignores it, and it
  // errs the dangerous way: the part looks twice as strong as it is.
  const base = {
    triangles: box(120, 20, 6),
    material: MATERIALS.pla,
    loadKg: 3,
    mode: "bend",
    axis: "x",
    infillPercent: 40,
  };
  const flat = stressTest({ ...base, orientation: "flat" });
  const edge = stressTest({ ...base, orientation: "on-edge" });
  const upright = stressTest({ ...base, orientation: "upright" });

  const bond = printing.layerBondFactor(MATERIALS.pla);
  const ratio = edge.safetyFactor / flat.safetyFactor;
  assert.ok(
    Math.abs(ratio - 1 / bond) < 0.02,
    `on-edge/flat was ${ratio.toFixed(2)}, expected ${(1 / bond).toFixed(2)}`
  );
  assert.ok(upright.safetyFactor < flat.safetyFactor, "upright should be the worst");
  assert.equal(edge.orientation.improvement, 1, "on-edge has nothing to gain");
  assert.ok(flat.cautions.some((line) => /on edge/i.test(line)), "flat should be told about it");
});

await check("shear governs a short stubby part, bending a long one", () => {
  // Bending stress falls as the part gets shorter; shear does not. A
  // bending-only check therefore calls exactly the stubby parts safe that
  // aren't.
  const at = (len) =>
    stressTest({
      triangles: box(len, 40, 25),
      material: MATERIALS.pla,
      loadKg: 60,
      mode: "bend",
      axis: "x",
      orientation: "on-edge",
      infillPercent: 40,
    });
  assert.ok(at(4).shear.governs, "shear should govern a 4mm stub");
  assert.ok(!at(20).shear.governs, "bending should govern a 20mm arm");
  // Shear is a property of the root, so it must not change with length.
  assert.ok(
    Math.abs(at(4).shear.stressMPa - at(20).shear.stressMPa) < 0.01,
    "shear at the root changed with length, which is wrong"
  );
});

await check("a design review solves for the fix, and the sums add up", () => {
  const review = engineer.designReview({
    triangles: box(120, 20, 6),
    material: MATERIALS.pla,
    loadKg: 3,
    mode: "bend",
    axis: "x",
    orientation: "flat",
    infillPercent: 20,
  });
  assert.ok(review.report.safetyFactor < 1, "this arm should fail");
  assert.equal(review.governing, "bending");

  // Free fixes first — turning it round costs nothing and must be offered.
  assert.equal(review.fixes[0].cost, "free");
  assert.ok(review.fixes.some((fix) => fix.sufficient), "no fix was enough on its own");
  assert.ok(review.recommendation.length > 20);

  // Thickness goes as the square root of the improvement needed. For a
  // rectangle that is exact, so it is worth asserting rather than trusting.
  const deeper = engineer.thicknessFor(6, 2, 0.5);
  assert.ok(Math.abs(deeper - 12) < 0.001, `wanted 12mm, got ${deeper}`);
});

// --- acting unasked ----------------------------------------------------------

const initiative = await import("../src/lib/initiative.ts");
const interests = await import("../src/lib/interests.ts");

await check("nothing happens unasked unless it was switched on", async () => {
  // Off is the default, and it must be a real gate rather than a preference.
  const decision = await initiative.decideInitiative({ now: Date.now() });
  assert.equal(decision.status, "off", `initiative was ${decision.status} with no setting`);
  assert.match(decision.reason, /switched off/);
});

await check("interests weigh a phrase far above a single word", () => {
  const topics = interests.topicsIn("open the grand theft auto six trailer");
  assert.ok(topics.includes("grand theft"), "did not learn the phrase");
  // Scaffolding words must never become interests.
  for (const junk of ["open", "the", "trailer", "video"]) {
    assert.ok(!topics.includes(junk), `"${junk}" should not be an interest`);
  }
});

// --- typo tolerance for a site name ------------------------------------------

const websites = await import("../src/lib/websites.ts");

await check("a typo of a site name still finds the site", () => {
  const cases = [
    ["youtub", "YouTube"], ["netlfix", "Netflix"], ["gmial", "Gmail"],
    ["instgram", "Instagram"], ["wikipeda", "Wikipedia"], ["chatgtp", "ChatGPT"],
    ["facbook", "Facebook"], ["spotfy", "Spotify"],
  ];
  for (const [typo, wanted] of cases) {
    const site = websites.findWebsite(typo);
    assert.equal(site?.name, wanted, `"${typo}" -> ${site?.name ?? "nothing"}`);
  }
});

await check("a transposed pair of letters is one edit, not two", () => {
  // "gmial" for "gmail" is the single most common typo of that word, and a
  // plain Levenshtein distance charges it 2 — which a budget tight enough to
  // keep short names safe correctly rejects. Adjacent transposition has to
  // count as 1 for the typo everyone actually makes to be forgiven.
  assert.equal(websites.findWebsite("gmial")?.name, "Gmail");
});

await check("a short generic word is never swallowed by a longer name", () => {
  // "the" is a literal substring of the squashed alias "discordinthebrowser" —
  // found this by testing the fuzzy stage and it turned out to predate it.
  for (const word of ["the", "app", "web", "for", "and"]) {
    assert.equal(websites.findWebsite(word), null, `"${word}" matched something`);
  }
});

await check("fuzzy matching never fires on an ordinary sentence", () => {
  for (const sentence of [
    "how do i bake bread without an oven",
    "what is the capital of france",
    "please can you tell me a joke about a cat",
  ]) {
    assert.equal(websites.findWebsite(sentence), null, sentence);
  }
});

await check("a URL is never relabelled by a fuzzy guess", () => {
  // Correcting the LABEL on an address he actually typed would show him the
  // wrong site's name for a page that still opens exactly as typed.
  assert.equal(websites.findWebsite("gmial.com", { fuzzy: false }), null);
});

// --- opening a browser without re-scanning the disk every time --------------
//
// Windows-only behaviour, exercised here by pointing the same code at a fake
// Windows layout under a scratch ProgramFiles. process.platform is writable in
// Node and is restored in the finally block either way — nothing here is
// allowed to leak into the checks that run after it.

await check("resolving a browser is cached rather than repeated every open", async () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const realProgramFiles = process.env.ProgramFiles;
  const realProgramFilesX86 = process.env["ProgramFiles(x86)"];
  const realLocalAppData = process.env.LOCALAPPDATA;
  const realExistsSync = fs.existsSync;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-browser-test-"));
  const SETTINGS = path.join("data", "settings.json");
  const CACHE = path.join("data", ".browser-path.json");
  const hadSettings = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, "utf-8") : null;
  const hadCache = fs.existsSync(CACHE) ? fs.readFileSync(CACHE, "utf-8") : null;

  try {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.ProgramFiles = scratch;
    process.env["ProgramFiles(x86)"] = path.join(scratch, "does-not-exist-x86");
    process.env.LOCALAPPDATA = path.join(scratch, "does-not-exist-local");

    const layout = {
      chrome: [scratch, "Google", "Chrome", "Application", "chrome.exe"],
      firefox: [scratch, "Mozilla Firefox", "firefox.exe"],
      edge: [scratch, "Microsoft", "Edge", "Application", "msedge.exe"],
    };
    for (const parts of Object.values(layout)) {
      const target = path.join(...parts);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const chromePath = path.join(...layout.chrome);

    let existsSyncCalls = 0;
    fs.existsSync = (p) => { existsSyncCalls++; return realExistsSync(p); };

    fs.rmSync(CACHE, { force: true });
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(SETTINGS, JSON.stringify({ BROWSER: "firefox" }));

    const desktop = await import(`../src/lib/desktop.ts?browsertest=${Date.now()}`);

    existsSyncCalls = 0;
    assert.ok(await desktop.openWebsite({ url: "example.com" }).then(() => true).catch(() => false));
    assert.ok(fs.existsSync(CACHE), "cache was not written after the first open");
    const coldCalls = existsSyncCalls;

    existsSyncCalls = 0;
    assert.ok(await desktop.openWebsite({ url: "example.com" }).then(() => true).catch(() => false));
    assert.ok(
      existsSyncCalls < coldCalls,
      `warm open should need fewer filesystem checks than the cold scan (${existsSyncCalls} vs ${coldCalls})`
    );

    // A changed setting must not keep using the stale answer.
    fs.writeFileSync(SETTINGS, JSON.stringify({ BROWSER: "chrome" }));
    assert.ok(await desktop.openWebsite({ url: "example.com" }).then(() => true).catch(() => false));
    assert.equal(JSON.parse(fs.readFileSync(CACHE, "utf-8")).browser, "chrome");

    // The cached browser disappearing (uninstalled, moved) must self-heal
    // rather than fail the open.
    fs.rmSync(chromePath, { force: true });
    assert.ok(await desktop.openWebsite({ url: "example.com" }).then(() => true).catch(() => false));
    assert.notEqual(JSON.parse(fs.readFileSync(CACHE, "utf-8")).browser, "chrome");

    // A corrupted cache file must not crash the next open.
    fs.writeFileSync(CACHE, "{ not json");
    assert.ok(await desktop.openWebsite({ url: "example.com" }).then(() => true).catch(() => false));
  } finally {
    fs.existsSync = realExistsSync;
    if (realPlatform) Object.defineProperty(process, "platform", realPlatform);
    if (realProgramFiles === undefined) delete process.env.ProgramFiles;
    else process.env.ProgramFiles = realProgramFiles;
    if (realProgramFilesX86 === undefined) delete process.env["ProgramFiles(x86)"];
    else process.env["ProgramFiles(x86)"] = realProgramFilesX86;
    if (realLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = realLocalAppData;
    fs.rmSync(path.join("data", ".browser-path.json"), { force: true });
    if (hadCache !== null) fs.writeFileSync(CACHE, hadCache);
    if (hadSettings !== null) fs.writeFileSync(SETTINGS, hadSettings);
    else fs.rmSync(SETTINGS, { force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// --- report -----------------------------------------------------------------

for (const passed of done) console.log(`  ok  ${passed}`);
for (const failed of failures) console.log(`  FAIL  ${failed}`);
console.log(
  `\n${done.length} of ${done.length + failures.length} behaviours as intended` +
    (failures.length ? `, ${failures.length} not` : "")
);
process.exit(failures.length ? 1 : 0);
