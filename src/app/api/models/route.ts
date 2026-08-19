import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

interface OpenRouterModel {
  id: string;
  name?: string;
  supported_parameters?: string[];
}

/**
 * The models available on the configured OpenRouter key, narrowed to those
 * that can actually call tools — JARVIS without tools can talk but can't open
 * Spotify or read your email, so offering the rest would be offering a trap.
 *
 * Fetched live rather than listed in code: OpenRouter's catalogue turns over
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
      .map((model) => ({ id: model.id, name: model.name ?? model.id }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({
      models: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
