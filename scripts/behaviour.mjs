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
  assert.ok(source.includes("$env:AXIS_WINDOW_PID"), "focus goes through the environment");

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

// --- report -----------------------------------------------------------------

for (const passed of done) console.log(`  ok  ${passed}`);
for (const failed of failures) console.log(`  FAIL  ${failed}`);
console.log(
  `\n${done.length} of ${done.length + failures.length} behaviours as intended` +
    (failures.length ? `, ${failures.length} not` : "")
);
process.exit(failures.length ? 1 : 0);
