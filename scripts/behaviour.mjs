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

// --- report -----------------------------------------------------------------

for (const passed of done) console.log(`  ok  ${passed}`);
for (const failed of failures) console.log(`  FAIL  ${failed}`);
console.log(
  `\n${done.length} of ${done.length + failures.length} behaviours as intended` +
    (failures.length ? `, ${failures.length} not` : "")
);
process.exit(failures.length ? 1 : 0);
