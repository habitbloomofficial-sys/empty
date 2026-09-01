#!/usr/bin/env node
// Check everything, of every kind, in one command.
//
//   node scripts/verify.mjs
//
// "npx tsc && npx eslint" covers the TypeScript, which is two thirds of the
// files and none of the ones that have actually broken lately. The launcher is
// a .bat, the screen guide is Python, the phone is one enormous .html, and the
// helpers are .mjs — and every one of those can be wrong in a way that no
// TypeScript tool will ever notice.
//
// So this walks the whole repository and checks each file the way that kind of
// file can be checked: parsed, compiled, linted, or read for the mistakes that
// its language actually makes. Nothing is skipped silently — a file this does
// not know how to check is reported as unchecked rather than counted as passed.

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

function run(command, args, { allowFail = false } = {}) {
  try {
    return { ok: true, out: execFileSync(command, args, { encoding: "utf-8", stdio: "pipe" }) };
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    if (!allowFail) return { ok: false, out };
    return { ok: true, out };
  }
}

const tracked = execSync("git ls-files", { encoding: "utf-8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const byExtension = (...extensions) =>
  tracked.filter((file) => extensions.some((extension) => file.endsWith(extension)));

// --- TypeScript ------------------------------------------------------------

console.log("TypeScript…");
{
  const types = run("npx", ["tsc", "--noEmit"]);
  record("tsc --noEmit", types.ok, types.out.split("\n").slice(0, 12).join("\n"));

  const lint = run("npx", ["eslint"]);
  record("eslint", lint.ok, lint.out.split("\n").slice(0, 20).join("\n"));

  // tsc only checks what is reachable from the entry points. A file nobody
  // imports is never type-checked, and an orphan is usually a mistake.
  const sources = byExtension(".ts", ".tsx").filter(
    (file) => file.startsWith("src/") && !file.endsWith(".d.ts")
  );
  const orphans = [];
  for (const file of sources) {
    const stem = file.replace(/^src\//, "").replace(/\.(tsx?|d\.ts)$/, "");
    const base = path.basename(stem);
    // Route handlers, pages and layouts are entry points: Next imports them.
    if (/^(app|components)\//.test(stem) && /^(route|page|layout|not-found|proxy)$/.test(base)) continue;
    if (stem === "proxy") continue;

    const referenced = tracked.some((other) => {
      if (other === file || !/\.(ts|tsx|mjs)$/.test(other)) return false;
      const text = fs.readFileSync(other, "utf-8");
      return (
        text.includes(`/${base}"`) ||
        text.includes(`/${base}'`) ||
        text.includes(`"./${base}`) ||
        text.includes(`@/lib/${base}`) ||
        text.includes(`./${base}.ts`) ||
        text.includes(`components/${base}`)
      );
    });
    if (!referenced) orphans.push(file);
  }
  record(
    `every source file is imported somewhere (${sources.length} checked)`,
    orphans.length === 0,
    orphans.length ? `never imported:\n  ${orphans.join("\n  ")}` : ""
  );
}

// --- Python ----------------------------------------------------------------

console.log("Python…");
{
  const python = byExtension(".py");
  const broken = [];
  for (const file of python) {
    const compiled = run("python3", ["-m", "py_compile", file]);
    if (!compiled.ok) broken.push(`${file}: ${compiled.out.split("\n").slice(-3).join(" ")}`);
  }
  record(`python compiles (${python.length} files)`, broken.length === 0, broken.join("\n"));

  // Every script must answer --help without doing anything, which proves its
  // argument parsing is wired up and its imports resolve.
  const cli = [];
  for (const file of python) {
    const helped = run("python3", [file, "--help"]);
    if (!helped.ok || !/usage:/i.test(helped.out)) cli.push(`${file}: no usage line`);
  }
  record(`python scripts answer --help (${python.length})`, cli.length === 0, cli.join("\n"));
}

// --- Plain JavaScript modules ----------------------------------------------

console.log("Scripts…");
{
  const modules = byExtension(".mjs", ".js").filter((f) => !f.startsWith("node_modules"));
  const broken = [];
  for (const file of modules) {
    const checked = run("node", ["--check", file]);
    if (!checked.ok) broken.push(`${file}: ${checked.out.split("\n").slice(0, 3).join(" ")}`);
  }
  record(`node --check (${modules.length} files)`, broken.length === 0, broken.join("\n"));
}

// --- JSON ------------------------------------------------------------------

console.log("Data files…");
{
  const json = byExtension(".json", ".webmanifest");
  const broken = [];
  for (const file of json) {
    try {
      JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (error) {
      broken.push(`${file}: ${error.message}`);
    }
  }
  record(`JSON parses (${json.length} files)`, broken.length === 0, broken.join("\n"));
}

// --- The phone, which is one file and has no build step --------------------

console.log("Phone…");
{
  const html = byExtension(".html");
  const problems = [];
  for (const file of html) {
    const source = fs.readFileSync(file, "utf-8");
    const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    // A static page legitimately has no script — offline.html is one. What
    // matters is that any script it does have parses.
    for (const [index, [, body]] of scripts.entries()) {
      try {
        new Function(body);
      } catch (error) {
        problems.push(`${file} script ${index + 1}: ${error.message}`);
      }
    }
    // Tags that must balance, or the page renders as text.
    for (const tag of ["script", "style"]) {
      const open = (source.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
      const close = (source.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      if (open !== close) problems.push(`${file}: ${open} <${tag}> against ${close} </${tag}>`);
    }
  }
  record(`HTML parses and its scripts compile (${html.length} files)`, problems.length === 0, problems.join("\n"));
}

// --- Windows launchers -----------------------------------------------------
//
// These cannot be executed here, and they are the files that have broken most
// often — so they are read for the mistakes batch actually makes rather than
// assumed correct because nothing complained.

console.log("Launchers…");
{
  const batch = byExtension(".bat");
  const problems = [];

  for (const file of batch) {
    const source = fs.readFileSync(file, "utf-8");
    const lines = source.split(/\r?\n/);

    // Windows will run a .bat with Unix line endings, but a label at the end
    // of a file without CRLF is a classic silent failure.
    const bareLf = (source.match(/(?<!\r)\n/g) ?? []).length;
    if (bareLf > 0) {
      problems.push(
        `${file}: ${bareLf} line(s) end in LF rather than CRLF. cmd.exe tolerates it until ` +
          `it doesn't — labels and multi-line constructs are where it stops. See .gitattributes.`
      );
    }

    // The one that actually bites: a variable set inside a parenthesised block
    // and read inside the SAME block reads its old value, because the whole
    // block is expanded when it is parsed.
    let depth = 0;
    const setInBlock = new Map();
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (/^rem\b/i.test(trimmed)) return;
      const opens = (trimmed.match(/\(\s*$/) ?? []).length;
      const closes = /^\)/.test(trimmed) ? 1 : 0;
      if (depth > 0) {
        const assignment = /^set\s+"?([A-Za-z_][A-Za-z0-9_]*)=/i.exec(trimmed);
        if (assignment) setInBlock.set(assignment[1].toUpperCase(), i + 1);
        for (const [name, setAt] of setInBlock) {
          if (new RegExp(`%${name}%`, "i").test(trimmed) && i + 1 > setAt) {
            problems.push(
              `${file}:${i + 1}: reads %${name}% inside the same block that set it on line ${setAt} — ` +
                `batch expands the whole block at once, so this reads the OLD value. ` +
                `Use a goto label, or enabledelayedexpansion with !${name}!.`
            );
          }
        }
      }
      depth += opens;
      if (closes) {
        depth -= 1;
        if (depth <= 0) {
          depth = 0;
          setInBlock.clear();
        }
      }
    });

    // Every goto must have a label to land on.
    const labels = new Set(
      lines.map((l) => /^:([A-Za-z0-9_]+)/.exec(l.trim())?.[1]?.toLowerCase()).filter(Boolean)
    );
    for (const [i, line] of lines.entries()) {
      // rem lines are prose, and prose contains the word "goto".
      if (/^\s*rem\b/i.test(line)) continue;
      const target = /\bgoto\s+:?([A-Za-z0-9_]+)/i.exec(line)?.[1]?.toLowerCase();
      if (target && target !== "eof" && !labels.has(target)) {
        problems.push(`${file}:${i + 1}: goto ${target} — no such label`);
      }
    }
  }
  record(`batch launchers (${batch.length} files)`, problems.length === 0, problems.join("\n"));

  // The shell and PowerShell helpers, checked with their own parsers where one
  // exists.
  const shell = byExtension(".sh", ".command");
  const shellProblems = [];
  for (const file of shell) {
    const checked = run("bash", ["-n", file]);
    if (!checked.ok) shellProblems.push(`${file}: ${checked.out.split("\n").slice(0, 2).join(" ")}`);
  }
  record(`shell scripts parse (${shell.length} files)`, shellProblems.length === 0, shellProblems.join("\n"));
}

// --- Nothing secret, ever --------------------------------------------------

console.log("Secrets…");
{
  const patterns = [
    [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
    [/\bsk-[A-Za-z0-9]{40,}/, "an OpenAI key"],
    [/\bAIza[A-Za-z0-9_-]{30,}/, "a Google key"],
    [/\bAC[a-f0-9]{32}\b/, "a Twilio account SID"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  ];
  const found = [];
  for (const file of tracked) {
    if (/\.(png|ico|svg|jpg)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    for (const [pattern, what] of patterns) {
      if (pattern.test(text)) found.push(`${file}: looks like ${what}`);
    }
  }
  record("no secrets committed", found.length === 0, found.join("\n"));
}

// --- The build the launcher actually runs ----------------------------------

console.log("Build…");
{
  // `npm run build`, not `next build --turbopack`. The launcher runs the
  // former, and testing the other one is testing something he never does.
  const built = run("npm", ["run", "build"]);
  record("npm run build", built.ok, built.out.split("\n").slice(-15).join("\n"));
}

// --- Report ----------------------------------------------------------------

console.log("");
let failed = 0;
for (const { name, ok, detail } of results) {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}`);
  if (!ok) {
    failed++;
    if (detail) console.log(detail.replace(/^/gm, "        "));
  }
}
console.log(
  `\n${results.length - failed} of ${results.length} checks passed` +
    (failed ? `, ${failed} failed` : "")
);
process.exit(failed ? 1 : 0);
