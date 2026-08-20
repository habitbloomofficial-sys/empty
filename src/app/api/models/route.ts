import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

interface OpenRouterModel {
  id: string;
  name?: string;
  supported_parameters?: string[];
}

interface GitHubModel {
  id?: string;
  name?: string;
  publisher?: string;
  /** What the model can do; tool calling is the one that matters here. */
  capabilities?: string[];
  supported_output_modalities?: string[];
}

/**
 * The models a GitHub personal access token can reach.
 *
 * Ids are publisher-namespaced ("openai/gpt-4o"), which is what the inference
 * endpoint expects — passing the bare name is the usual first mistake.
 */
async function githubModels(token: string) {
  const res = await fetch("https://models.github.ai/catalog/models", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 401) {
      return { models: [], error: "GitHub rejected that token. Create a new one and copy it in full." };
    }
    if (res.status === 403 || res.status === 404) {
      return {
        models: [],
        error:
          "That token can't reach GitHub Models. A fine-grained token needs the “Models” permission set to read — add it, or use a classic token.",
      };
    }
    return { models: [], error: `GitHub wouldn't list its models (HTTP ${res.status}).` };
  }

  const body = (await res.json()) as GitHubModel[] | { models?: GitHubModel[] };
  const list = Array.isArray(body) ? body : (body.models ?? []);

  const models = list
    .map((model) => {
      const id = model.id ?? "";
      return { id, name: model.name ?? id };
    })
    .filter((model) => model.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { models };
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
  const githubToken = getSetting("GITHUB_MODELS_TOKEN");
  const key = getSetting("OPENROUTER_API_KEY");

  if (githubToken && !key) {
    try {
      return NextResponse.json(await githubModels(githubToken));
    } catch (err) {
      return NextResponse.json({
        models: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
