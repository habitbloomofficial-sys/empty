import fs from "node:fs";
import path from "node:path";
import { getSetting } from "./settings";
import { outputFolder, safeFilename, uniquePath } from "./documents";

// Making a video out of a sentence.
//
// Google's Veo does the work, through the same Gemini key that runs his brain.
// It is a long-running operation rather than a request: you ask, you get an
// operation name back, and you poll it for a minute or three until a file
// appears.
//
// The part that matters more than the code: **this costs real money, per
// video, every time.** Somewhere between one and three dollars for eight
// seconds, depending on the model, and there is no free tier for it anywhere —
// not Google's, not anyone's. Video generation is the single most expensive
// thing Axis can be asked to do, and a spoken assistant that can spend three
// dollars on a misheard sentence is a bad idea.
//
// So it is off until switched on, it names its price before it starts, and it
// will not start two in the same minute.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** How long to keep asking whether it's finished. */
const POLL_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_EVERY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** One at a time, and not two in a minute. Each of these is money. */
export const VIDEO_COOLDOWN_MS = 60_000;
let lastVideoAt = 0;

export function isVideoEnabled(): boolean {
  return (getSetting("VIDEO_GENERATION") ?? "off").toLowerCase() === "on";
}

function key(): string {
  const value = getSetting("GEMINI_API_KEY");
  if (!value) {
    throw new Error(
      "Making a video needs a Gemini key, sir — it's the same one that can run my brain."
    );
  }
  return value;
}

/**
 * Which Veo to use.
 *
 * Discovered rather than hard-coded, for the same reason the chat model is:
 * Google renames and retires these on its own schedule, and a name written into
 * this file goes stale silently. Among what's offered, the cheapest wins —
 * "fast" and "lite" variants cost a fraction of the standard one and the
 * difference is not what anyone notices in an eight-second clip of a dog.
 */
export function preferVeo(names: string[]): string | null {
  const veo = names.filter((name) => /veo/i.test(name));
  if (veo.length === 0) return null;

  const score = (name: string) => {
    let points = 0;
    if (/lite/i.test(name)) points += 3;
    if (/fast/i.test(name)) points += 2;
    // A stable model over a preview, all else equal.
    if (!/preview|exp/i.test(name)) points += 1;
    return points;
  };

  return [...veo].sort((a, b) => score(b) - score(a) || b.localeCompare(a))[0];
}

let cachedModel: string | null = null;

export async function videoModel(): Promise<string> {
  const configured = getSetting("VEO_MODEL")?.trim();
  if (configured) return configured;
  if (cachedModel) return cachedModel;

  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": key() },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await googleError(res, "Listing the video models");

  const body = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const names = (body.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("predictLongRunning"))
    .map((model) => (model.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);

  const chosen = preferVeo(names);
  if (!chosen) {
    throw new Error(
      "This Gemini key has no video model available to it, sir. Video generation is a paid feature — the key needs billing enabled on it."
    );
  }
  cachedModel = chosen;
  return chosen;
}

async function googleError(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    const message = (body as { error?: { message?: string } })?.error?.message;
    if (typeof message === "string") detail = message.trim().replace(/[.\s]+$/, "");
  } catch {
    // Nothing worth repeating.
  }

  if (res.status === 429 || /quota|billing|not enabled|permission/i.test(detail)) {
    return new Error(
      `${what} was refused, sir${detail ? ` — ${detail}` : ""}. Video generation is billed per video, so the key needs a billing account behind it.`
    );
  }
  return new Error(`${what} failed (HTTP ${res.status})${detail ? ` — ${detail}` : ""}.`);
}

export interface VideoResult {
  path: string;
  model: string;
  prompt: string;
  seconds: number;
  note: string;
}

export interface VideoOptions {
  /** "16:9" for something to watch, "9:16" for a phone. */
  aspectRatio?: string;
}

/** Where finished videos land: beside his documents, in a folder of their own. */
function videosFolder(): string {
  const folder = path.join(outputFolder(), "Videos");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export async function generateVideo(
  rawPrompt: string,
  options: VideoOptions = {}
): Promise<VideoResult> {
  if (!isVideoEnabled()) {
    throw new Error(
      "Making videos is switched off, sir. Each one costs real money — a dollar or three for a few seconds — so it stays off until you turn it on in Settings, under Video."
    );
  }

  const prompt = rawPrompt.trim();
  if (!prompt) throw new Error("What would you like the video to be of, sir?");
  if (prompt.length > 2000) throw new Error("That description is too long for one video, sir.");

  const since = Date.now() - lastVideoAt;
  if (since < VIDEO_COOLDOWN_MS) {
    const wait = Math.ceil((VIDEO_COOLDOWN_MS - since) / 1000);
    throw new Error(
      `I made one a moment ago, sir — give it ${wait} seconds. Each of these costs money, so I won't fire off two by accident.`
    );
  }

  const model = await videoModel();
  const aspectRatio = options.aspectRatio === "9:16" ? "9:16" : "16:9";

  const started = await fetch(`${BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio, sampleCount: 1 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!started.ok) throw await googleError(started, "Starting the video");

  // Only now: the money is committed the moment Google accepts the job.
  lastVideoAt = Date.now();

  const { name: operation } = (await started.json()) as { name?: string };
  if (!operation) throw new Error("Google accepted the video but didn't say where to find it, sir.");

  const uri = await waitForVideo(operation);
  const file = await download(uri, prompt);

  return {
    path: file,
    model,
    prompt,
    seconds: 8,
    note: `Saved to ${file}. That one cost money — it's billed per video on your Gemini key.`,
  };
}

/** Poll the operation until a video falls out of it, or time runs out. */
async function waitForVideo(operation: string): Promise<string> {
  const until = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));

    const res = await fetch(`${BASE}/${operation}`, {
      headers: { "x-goog-api-key": key() },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw await googleError(res, "Checking on the video");

    const body = (await res.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: {
        generateVideoResponse?: {
          generatedSamples?: { video?: { uri?: string } }[];
          raiMediaFilteredReasons?: string[];
        };
      };
    };

    if (!body.done) continue;
    if (body.error?.message) throw new Error(`The video failed, sir — ${body.error.message}`);

    const generated = body.response?.generateVideoResponse;
    const uri = generated?.generatedSamples?.[0]?.video?.uri;
    if (uri) return uri;

    // Refused rather than failed: Google declined to make this one.
    const refused = generated?.raiMediaFilteredReasons?.[0];
    throw new Error(
      refused
        ? `Google wouldn't make that one, sir — ${refused}`
        : "The video finished with nothing in it, sir."
    );
  }

  throw new Error(
    "The video is taking longer than I'll wait, sir. It may still finish — it's worth asking again in a few minutes before paying for another."
  );
}

async function download(uri: string, prompt: string): Promise<string> {
  const res = await fetch(uri, {
    headers: { "x-goog-api-key": key() },
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await googleError(res, "Downloading the video");

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("The video came back empty, sir.");

  // Named after what was asked for, so the folder reads like a list of ideas.
  const filename = safeFilename(prompt.split(/[.!?\n]/)[0].slice(0, 60) || "video", ".mp4");
  const file = uniquePath(videosFolder(), filename);
  fs.writeFileSync(file, bytes);
  return file;
}
