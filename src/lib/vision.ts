import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { anthropicModel, getAIProvider } from "./ai";
import { getSetting } from "./settings";

// Looking at something through the webcam.
//
// Three rules shape this file, and they are about whose camera it is rather
// than about code.
//
// ONE FRAME, ASKED FOR. Nothing here opens a stream, watches, or runs on a
// timer. A still is captured at the moment he asks for one and that is the
// only time the camera is read. An assistant that can see continuously is a
// different and much larger thing than one that can be shown something, and
// he asked for the second.
//
// NOTHING IS KEPT. The frame goes to the model and is gone. It is never
// written to disk, never added to the conversation history, never sent
// anywhere twice. There is no folder of pictures of his room to leak, lose or
// forget about, because there is no folder.
//
// IT LEAVES THE MACHINE, AND HE IS TOLD SO. Describing an image needs the
// model, and the model is somebody else's computer. That is a real thing to
// know about a camera in your bedroom, so it is said in the interface rather
// than buried here.

/** Bigger than this and the request is slow and no more accurate. */
export const MAX_IMAGE_BYTES = 4_000_000;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function isImageType(value: string): value is ImageType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export interface LookParams {
  /** The frame, base64, WITHOUT a data: prefix. */
  imageBase64: string;
  mediaType: ImageType;
  /** What he wants to know. Left out, it is described. */
  question?: string;
}

export interface LookResult {
  answer: string;
  provider: string;
  model: string;
}

/** Which providers here can actually see. */
export function canSee(): boolean {
  const provider = getAIProvider();
  return provider === "anthropic" || provider === "openai";
}

const DEFAULT_QUESTION =
  "Describe what you can see, briefly and concretely. Name the things that are actually " +
  "identifiable and say plainly when something is too unclear to make out.";

const SYSTEM =
  "You are looking through a webcam on the user's desk, at his request. Answer the question " +
  "about what is in the picture in two or three sentences, plainly and specifically.\n\n" +
  "Say what you can actually see. If something is blurry, cut off, or too dark to identify, " +
  "say that rather than guessing at it — a confident wrong answer about an object in his room " +
  "is worse than 'I can't make that out'. Do not describe or comment on people's appearance. " +
  "Do not read out anything that looks like a password, a card number, or a private document, " +
  "even if it is legible; say that there is one visible and leave it at that.";

/**
 * Show the model one frame and ask about it.
 *
 * Anthropic and OpenAI are handled separately rather than through the Brain
 * abstraction, which is text-only and shared by four providers. Threading
 * image blocks through all four to serve the two that can see would be a much
 * larger change with far more to break — and this needs to still work in a
 * year with nobody maintaining it.
 */
export async function look(params: LookParams): Promise<LookResult> {
  const question = params.question?.trim() || DEFAULT_QUESTION;
  const bytes = Math.floor((params.imageBase64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(
      `That picture is ${(bytes / 1_000_000).toFixed(1)} MB, sir — more than I can send. ` +
        "The camera should be sending a smaller frame than that."
    );
  }
  if (!params.imageBase64) throw new Error("There's no picture there, sir.");

  const provider = getAIProvider();

  if (provider === "anthropic") {
    const key = getSetting("ANTHROPIC_API_KEY");
    if (!key) throw new Error("No Claude key is set, sir.");
    const client = new Anthropic({ apiKey: key });
    const model = anthropicModel();

    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: params.mediaType, data: params.imageBase64 },
            },
            { type: "text", text: question },
          ],
        },
      ],
    });

    // A decline arrives as a normal 200 with nothing useful in it.
    if (message.stop_reason === "refusal") {
      throw new Error("Claude declined to describe that one, sir.");
    }
    const answer = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return { answer: answer || "I couldn't make anything out, sir.", provider, model };
  }

  if (provider === "openai") {
    const key = getSetting("OPENAI_API_KEY");
    if (!key) throw new Error("No OpenAI key is set, sir.");
    const client = new OpenAI({ apiKey: key });
    const model = getSetting("OPENAI_MODEL") || "gpt-4o";

    const completion = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: { url: `data:${params.mediaType};base64,${params.imageBase64}` },
            },
          ],
        },
      ],
    });
    const answer = completion.choices[0]?.message?.content?.trim();
    return { answer: answer || "I couldn't make anything out, sir.", provider, model };
  }

  throw new Error(
    "Looking through the camera needs a Claude or OpenAI key, sir — the others here can't see pictures."
  );
}
