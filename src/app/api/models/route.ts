import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

interface OpenRouterModel {
  id: string;
  name?: string;
  supported_parameters?: string[];
  /** Per-token prices as decimal strings; "0" means free. */
  pricing?: { prompt?: string; completion?: string };
}

/**
 * Whether a model costs nothing to use.
 *
 * Two signals, because either alone misses cases: OpenRouter suffixes free
 * variants with ":free", and separately quotes a price of zero. A model is
 * free if either says so.
 */
function isFree(model: OpenRouterModel): boolean {
  if (model.id.endsWith(":free")) return true;
  const prompt = Number(model.pricing?.prompt ?? "1");
  const completion = Number(model.pricing?.completion ?? "1");
  return prompt === 0 && completion === 0;
}

/**
 * The models available on the configured key, narrowed where possible to those
 * that can actually call tools — JARVIS without tools can talk but can't open
 * Spotify or read your email, so offering the rest would be offering a trap.
 *
 * Fetched live rather than listed in code: these catalogues turn over
 * constantly, and any list written here would be wrong within months.
 */
export async function GET() {
  const key = getSetting("OPENROUTER_API_KEY");
  if (!key) return NextResponse.json({ models: [] });

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        models: [],
        error: `OpenRouter wouldn't list its models (HTTP ${res.status}).`,
      });
    }

    const body = (await res.json()) as { data?: OpenRouterModel[] };
    const models = (body.data ?? [])
      .filter((model) => model.supported_parameters?.includes("tools"))
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        free: isFree(model),
      }))
      // Free ones first: they're what most people are looking for, and they
      // are otherwise scattered through a list of hundreds.
      .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));

    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({
      models: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
