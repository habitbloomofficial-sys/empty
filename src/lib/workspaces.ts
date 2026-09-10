import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite";
import { MAX_TABS, type OpenWebsiteParams } from "./desktop";

// A workspace is a set of pages with a name on it.
//
// "Open my morning" should not be six sentences. He says the name, and the
// tabs he always has at that time of day come up together in one window.
//
// These live in data/workspaces.json rather than in settings.json, because
// they are a list that grows rather than a value with a slot — and because a
// workspace is his, not configuration. Settings are things Axis needs; these
// are things he made.

const STORE = path.join(process.cwd(), "data", "workspaces.json");

/** One page in a workspace: a name he uses, or an address, or a search. */
export interface WorkspacePage {
  /** A site by name — "gmail", "shopify", "google docs". */
  site?: string;
  /** A full address, for anything not known by name. */
  url?: string;
  /** Search terms, within the site when there is one. */
  query?: string;
}

export interface Workspace {
  name: string;
  pages: WorkspacePage[];
  createdAt: number;
}

function read(): Workspace[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    // Written by us, but a file on disk is a file on disk: anything that isn't
    // shaped like a workspace is dropped rather than trusted into a launch.
    return parsed.filter(
      (entry): entry is Workspace =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Workspace).name === "string" &&
        Array.isArray((entry as Workspace).pages)
    );
  } catch {
    return [];
  }
}

function write(workspaces: Workspace[]): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  writeFileAtomic(STORE, JSON.stringify(workspaces, null, 2));
}

/** Loose match, so "my morning" finds "Morning". */
function same(a: string, b: string): boolean {
  const tidy = (value: string) =>
    value.toLowerCase().replace(/^(my|the)\s+/, "").replace(/\s+(setup|tabs|workspace)$/, "").trim();
  return tidy(a) === tidy(b);
}

export function listWorkspaces(): Workspace[] {
  return read().sort((a, b) => a.name.localeCompare(b.name));
}

export function findWorkspace(name: string): Workspace | null {
  const wanted = name.trim();
  if (!wanted) return null;
  const all = read();
  return (
    all.find((workspace) => same(workspace.name, wanted)) ??
    // Then a containment match, so "work" finds "Work morning".
    all.find((workspace) => workspace.name.toLowerCase().includes(wanted.toLowerCase())) ??
    null
  );
}

export function saveWorkspace(name: string, pages: WorkspacePage[]): Workspace {
  const tidy = name.trim();
  if (!tidy) throw new Error("A workspace needs a name, sir.");
  if (pages.length === 0) throw new Error("A workspace needs at least one page in it, sir.");
  if (pages.length > MAX_TABS) {
    throw new Error(`That's more than ${MAX_TABS} pages, sir — a workspace holds up to that many.`);
  }

  const workspace: Workspace = { name: tidy, pages, createdAt: Date.now() };
  const all = read().filter((existing) => !same(existing.name, tidy));
  all.push(workspace);
  write(all);
  return workspace;
}

export function forgetWorkspace(name: string): Workspace | null {
  const all = read();
  const going = all.find((workspace) => same(workspace.name, name.trim()));
  if (!going) return null;
  write(all.filter((workspace) => workspace !== going));
  return going;
}

/** A workspace's pages in the shape the opener wants. */
export function pagesToOpen(workspace: Workspace): OpenWebsiteParams[] {
  return workspace.pages.map((page) => ({
    site: page.site,
    url: page.url,
    query: page.query,
  }));
}
