import fs from "node:fs";
import path from "node:path";
import { getSetting } from "./settings";
import { outputFolder, safeFilename, uniquePath } from "./documents";

// YouTube thumbnails, made by asking an image model.
//
// The same shape as video.ts, and for the same reasons: it costs money per
// picture, so the model to use is discovered rather than hard-coded (Google
// renames these faster than this file changes), and the price is put to him
// before anything is spent — see spend.ts, where that is a gate rather than a
// good intention.
//
// A thumbnail is 1280x720. Not a suggestion: YouTube's own requirement, and a
// square picture cropped to fit is how you lose the half of it that mattered.

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 120_000;

/** What one costs, roughly, on Google's image models. */
export const PRICE_LOW = 0.03;
export const PRICE_HIGH = 0.12;

export function isThumbnailEnabled(): boolean {
  return (getSetting("THUMBNAILS") ?? "off").toLowerCase() === "on";
}

function key(): string {
  const configured = getSetting("GEMINI_API_KEY")?.trim();
  if (!configured) {
    throw new Error(
      "Making a thumbnail needs the Gemini key, sir — the same one his brain can run on. It goes in Settings, under the brain."
    );
  }
  return configured;
}

async function googleError(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    const message = (body as { error?: { message?: string } })?.error?.message;
    if (typeof message === "string") detail = message.trim().replace(/[.\s]+$/, "");
  } catch {
    // No body worth reading; the status will have to do.
  }
  if (res.status === 429) {
    return new Error(`${what} hit the rate limit, sir. A minute should clear it.`);
  }
  if (res.status === 403 || res.status === 400) {
    return new Error(
      `${what} was refused, sir${detail ? ` — ${detail}` : ""}. Image generation is billed per picture, so the key needs a billing account behind it.`
    );
  }
  return new Error(`${what} failed (HTTP ${res.status})${detail ? ` — ${detail}` : ""}.`);
}

/**
 * Which image model this key can actually use.
 *
 * Discovered from the key's own model list rather than written down, because a
 * name written down here goes stale and the failure lands as "404" on the one
 * day he wanted a thumbnail. Preference goes to the cheaper and the stable.
 */
export function preferImageModel(names: string[]): string | null {
  const images = names.filter((name) => /image|imagen/i.test(name) && !/embed|vision/i.test(name));
  if (images.length === 0) return null;

  const score = (name: string) => {
    let points = 0;
    if (/flash|fast|lite/i.test(name)) points += 3;
    if (!/preview|exp/i.test(name)) points += 2;
    if (/imagen/i.test(name)) points += 1;
    return points;
  };
  return [...images].sort((a, b) => score(b) - score(a) || b.localeCompare(a))[0];
}

let cachedModel: string | null = null;

export async function imageModel(): Promise<string> {
  const configured = getSetting("IMAGE_MODEL")?.trim();
  if (configured) return configured;
  if (cachedModel) return cachedModel;

  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": key() },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await googleError(res, "Listing the image models");

  const body = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const names = (body.models ?? [])
    .filter((model) =>
      model.supportedGenerationMethods?.some((method) =>
        /generateContent|predict/i.test(method)
      )
    )
    .map((model) => (model.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);

  const chosen = preferImageModel(names);
  if (!chosen) {
    throw new Error(
      "This Gemini key has no image model available to it, sir. Making pictures is a paid feature — the key needs billing enabled on it."
    );
  }
  cachedModel = chosen;
  return chosen;
}

/**
 * Turn what he said into something an image model can use.
 *
 * A thumbnail is not an illustration: it is read at the size of a postage
 * stamp, in a column of forty others. So the prompt asks for the things that
 * survive being small — one subject, high contrast, a face if there is one,
 * room for a title — and asks for no lettering, because image models spell
 * badly and a misspelled word on a thumbnail is worse than no word at all. His
 * own title goes on afterwards, in an editor, spelled correctly.
 */
export function buildPrompt(subject: string, style?: string): string {
  const look = style?.trim()
    ? style.trim()
    : "bold, high-contrast, saturated colour, dramatic lighting, clean background";
  return [
    `A YouTube thumbnail image: ${subject.trim()}.`,
    `Style: ${look}.`,
    "Composition: one clear subject filling most of the frame, strong silhouette,",
    "sharp focus, high contrast so it reads clearly at a very small size.",
    "Leave some uncluttered space on one side for a title to be added later.",
    "No text, no words, no letters, no numbers, no watermark, no logo.",
    "16:9 landscape.",
  ].join(" ");
}

export interface MadeThumbnail {
  path: string;
  filename: string;
  folder: string;
  model: string;
}

/** Where the picture data hides in a response, whichever shape came back. */
function extractImage(body: unknown): { data: string; mime: string } | null {
  const root = body as {
    // generateContent
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    // predict
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
  };

  for (const part of root.candidates?.[0]?.content?.parts ?? []) {
    const inline = part.inlineData;
    if (inline?.data) return { data: inline.data, mime: inline.mimeType ?? "image/png" };
  }
  const prediction = root.predictions?.[0];
  if (prediction?.bytesBase64Encoded) {
    return { data: prediction.bytesBase64Encoded, mime: prediction.mimeType ?? "image/png" };
  }
  return null;
}

/**
 * Make one, and write it to disk.
 *
 * Nothing in here checks whether he agreed to the cost — that is deliberately
 * somewhere else. This function spends money every time it is called, and the
 * only thing standing in front of it is the gate in spend.ts, which the tool
 * goes through. Keeping the two apart means the gate cannot be accidentally
 * satisfied by the same code that wants to get past it.
 */
export async function makeThumbnail(subject: string, style?: string): Promise<MadeThumbnail> {
  if (!subject.trim()) throw new Error("A thumbnail of what, sir?");

  const model = await imageModel();
  const prompt = buildPrompt(subject, style);

  // Two request shapes, because Google's image models are split across them:
  // the Gemini ones take generateContent, the Imagen ones take predict.
  const useImagen = /imagen/i.test(model);
  const url = `${BASE}/models/${encodeURIComponent(model)}:${useImagen ? "predict" : "generateContent"}`;
  const payload = useImagen
    ? {
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "16:9" },
      }
    : {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
      };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await googleError(res, "Making the thumbnail");

  const image = extractImage(await res.json());
  if (!image) {
    throw new Error(
      "The model answered without a picture in it, sir. That usually means the request was declined rather than failed — try describing it differently."
    );
  }

  const folder = path.join(outputFolder(), "Thumbnails");
  fs.mkdirSync(folder, { recursive: true });
  const extension = image.mime.includes("jpeg") ? "jpg" : "png";
  const target = uniquePath(folder, safeFilename(subject.slice(0, 60), extension));

  fs.writeFileSync(target, Buffer.from(image.data, "base64"));
  return { path: target, filename: path.basename(target), folder, model };
}
