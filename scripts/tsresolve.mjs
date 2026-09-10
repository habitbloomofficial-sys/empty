// Let plain `node` import this project's TypeScript.
//
// Two things stand between Node and a .ts file in src/: the imports have no
// extension, and they use the "@/..." alias that tsconfig maps onto src/. Node
// resolves neither. This hook does both, so scripts/behaviour.mjs can import
// the real modules rather than a copy of their logic — a test of a copy proves
// only that the copy still agrees with itself.
//
// Type STRIPPING is Node's own (--experimental-strip-types); this is purely
// about finding the file.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  let spec = specifier;
  // A "?v=2" suffix is how a caller asks for a fresh copy of a module rather
  // than the cached one. It is part of the URL, never part of the file name,
  // so it is set aside for the lookup and put back afterwards.
  const query = /^[.@]|^file:/.test(spec) ? (spec.match(/\?[^?]*$/)?.[0] ?? "") : "";
  if (query) spec = spec.slice(0, -query.length);
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(ROOT, "src", spec.slice(2))).href;
  }

  if (spec.startsWith(".") || spec.startsWith("file:")) {
    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec);

    if (!path.extname(base)) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(candidate)) return next(pathToFileURL(candidate).href + query, context);
      }
    }
    return next(pathToFileURL(base).href + query, context);
  }
  return next(specifier, context);
}
