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

// --- Files that are here but are not part of Axis ---------------------------
//
// tsconfig compiles **/*.ts and **/*.tsx, so ANY stray TypeScript under src/
// is type-checked as though it belonged — and a half-copy of another project
// fails with forty lines of "cannot find module" that name files this
// repository has never contained. That is a confusing way to learn that the
// folder has two projects in it.

console.log("Strays…");
{
  const trackedInSrc = new Set(tracked.filter((f) => f.startsWith("src/")));
  const onDisk = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) onDisk.push(full.replace(/\\/g, "/"));
    }
  };
  if (fs.existsSync("src")) walk("src");

  // Git decides what is ignored; asking it is more honest than reimplementing
  // .gitignore here and getting it subtly wrong.
  const untracked = onDisk.filter((f) => !trackedInSrc.has(f));
  const strays = untracked.filter((f) => {
    const ignored = run("git", ["check-ignore", "-q", f], { allowFail: true });
    try {
      execFileSync("git", ["check-ignore", "-q", f], { stdio: "pipe" });
      return false; // ignored on purpose
    } catch {
      return true; // not ignored, not tracked — a stray
    }
    void ignored;
  });

  record(
    `no stray TypeScript under src/ (${onDisk.length} files on disk)`,
    strays.length === 0,
    strays.length
      ? `These are in the folder but are not part of Axis on this branch:\n  ${strays.join("\n  ")}\n\n` +
        `  tsc compiles everything under src/, so they break the build even though\n` +
        `  nothing in Axis imports them. They are most likely left over from another\n` +
        `  project worked on in this same folder. Check with:  git status --short src\n` +
        `  and, once you have looked at the list:  git clean -n -d src   (then -f to delete)`
      : ""
  );

  // A SECOND PROJECT NESTED INSIDE THIS ONE.
  //
  // The stray check above only ever looked under src/, and the thing that
  // actually bit was one level up: a whole other checkout at C:\...\empty\empty,
  // carrying its own package.json and its own src/. tsconfig used to compile
  // **/*.ts, so every file in it was type-checked as part of Axis, and the
  // build failed with fifty "cannot find module" lines naming a project this
  // branch has never contained.
  //
  // tsconfig is now scoped to src/, so a folder like that can no longer break
  // the build. It is still worth saying out loud, because everything else in
  // the folder - git status, a search, the next person to look - is confused
  // by it, and because nobody puts one there on purpose.
  const nested = [];
  const skip = new Set(["node_modules", ".next", ".git", "data", "Documents"]);
  const hunt = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, "package.json"))) {
        nested.push(full.replace(/\\/g, "/"));
        continue; // named it; no need to walk inside it as well
      }
      hunt(full, depth + 1);
    }
  };
  hunt(".", 0);

  record(
    `no second project nested in this folder`,
    nested.length === 0,
    nested.length
      ? `Each of these is a folder with its own package.json inside the Axis folder:\n  ${nested.join("\n  ")}\n\n` +
        `  That is a whole separate project sitting inside this one. One project per\n` +
        `  folder: move it somewhere else, or delete it once you have looked at what\n` +
        `  is in it. Nothing in Axis reads it, and leaving it there makes every\n` +
        `  search, every git status and every build log harder to read.`
      : ""
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

  // Every launcher says which version it is, on screen and in its log.
  //
  // This exists because of a day spent on a bug that was already fixed. The
  // repaired REBUILD-AXIS.bat was on GitHub and the broken one was on his
  // machine, and nothing either of us could see said so — the file gave no
  // way to tell one copy from another, so every symptom pointed at the fix
  // being wrong rather than absent. A stamp turns "it still says the old
  // thing" into a number that settles it in one line.
  const stamps = new Map();

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

    // A failure message that names a cause must not be shared by two DIFFERENT
    // failures. REBUILD-AXIS.bat sent both "npm install failed" and "npm run
    // build failed" to one label that blamed the internet — so a broken build
    // told him his connection had dropped, and rerunning could never help.
    //
    // Reached twice is not itself the fault: START-AXIS-PHONE.bat checks the
    // same firewall state before and after trying to fix it, and one message is
    // right both times. What distinguishes them is the command each jump
    // follows — two different commands failing into one explanation is the bug.
    const blames = /\b(internet|connection|network|offline|wi-?fi)\b/i;
    // The WHOLE command, not its first two words: "call npm install" and "call
    // npm run build" are different failures, and a pattern that stops at the
    // first space reads both as "call npm" and sees no difference at all.
    const COMMAND = /^\s*((?:call|npm|node|git|powershell|netstat|where)\b.*)$/i;

    const bodies = new Map();
    let current = null;
    for (const line of lines) {
      const label = /^:([A-Za-z0-9_]+)/.exec(line.trim())?.[1]?.toLowerCase();
      if (label) {
        current = label;
        bodies.set(current, "");
      } else if (current) {
        bodies.set(current, bodies.get(current) + line + "\n");
      }
    }

    // For each jump, the command it is reacting to.
    const causes = new Map();
    lines.forEach((line, i) => {
      if (/^\s*rem\b/i.test(line)) return;
      const target = /\bgoto\s+:?([A-Za-z0-9_]+)/i.exec(line)?.[1]?.toLowerCase();
      if (!target) return;
      let cause = "(start of file)";
      for (let back = i - 1; back >= 0 && back > i - 12; back--) {
        const match = COMMAND.exec(lines[back]);
        if (match) {
          cause = match[1].trim().toLowerCase();
          break;
        }
      }
      if (!causes.has(target)) causes.set(target, new Set());
      causes.get(target).add(cause);
    });

    for (const [label, body] of bodies) {
      if (!blames.test(body)) continue;
      const distinct = causes.get(label);
      if (distinct && distinct.size > 1) {
        problems.push(
          `${file}: :${label} blames the connection but is reached after ${distinct.size} ` +
            `different commands (${[...distinct].join(", ")}). Whichever one it isn't, the ` +
            `message is wrong and rerunning cannot help. Give each failure its own label.`
        );
      }
    }

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

    const stamp = /^rem LAUNCHER VERSION (\S+)/m.exec(source)?.[1];
    if (!stamp) {
      problems.push(
        `${file}: no "rem LAUNCHER VERSION <version>" line. Without one there is no way to ` +
          `tell, from the machine running it, whether this copy is the current one.`
      );
    } else if (!new RegExp(`echo\\s+launcher ${stamp}\\b`).test(source)) {
      problems.push(
        `${file}: stamped ${stamp} but never echoes it. A version only in a comment cannot ` +
          `be read off the screen when the launcher fails, which is the moment it is wanted.`
      );
    } else {
      stamps.set(file, stamp);
    }
  }

  // One release, one number. Launchers stamped differently mean a half-applied
  // update, which is the confusion this was built to end rather than cause.
  const distinctStamps = new Set(stamps.values());
  if (distinctStamps.size > 1) {
    const listed = [...stamps].map(([file, stamp]) => `${file}=${stamp}`).join(", ");
    problems.push(
      `launchers carry ${distinctStamps.size} different versions (${listed}). ` +
        `They ship together, so they should say the same thing.`
    );
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
