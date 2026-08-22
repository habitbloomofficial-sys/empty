import Anthropic from "@anthropic-ai/sdk";
import { anthropicEffort, anthropicModel, getMaxTokens } from "./ai";
import { getSetting } from "./settings";
import type { Brain, BrainInput, BrainReply, BrainToolCall } from "./brain";

// Claude, through Anthropic's own SDK.
//
// Not through an OpenAI-compatible endpoint: the Messages API is a different
// shape — tools are declared flat rather than nested under `function`, a tool
// call comes back as a `tool_use` content block rather than a stream of
// argument fragments, and a tool result goes back as a `user` message rather
// than a `tool` one. Translating happens here, once, in the open.
//
// Thinking is left alone. Claude Opus 5 thinks by default and turning it off
// has a specific failure mode — the model writes a tool call into its visible
// text instead of actually calling it, which in Axis's loop means telling you
// Spotify is open when nothing happened. Depth is controlled with `effort`
// instead, which defaults to low here: deciding to open Spotify does not
// warrant deliberation, and every second of thinking is a second of silence
// before he starts speaking.

export function anthropicClient(): Anthropic {
  const apiKey = getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("No Anthropic key saved yet, sir — add one in Settings.");
  }
  return new Anthropic({ apiKey });
}

/** OpenAI's nested tool shape, flattened into Anthropic's. */
export function toAnthropicTools(
  tools: BrainInput["tools"]
): { name: string; description: string; input_schema: Anthropic.Tool.InputSchema }[] {
  return tools
    .filter((tool) => tool.type === "function")
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description ?? "",
      input_schema: (tool.function.parameters ?? {
        type: "object",
        properties: {},
      }) as Anthropic.Tool.InputSchema,
    }));
}

/**
 * Pull the reply out of a finished message.
 *
 * Only `tool_use` blocks are ours to run. Anything else Claude may have put
 * there — thinking, a server-side search he ran himself — is left alone and
 * carried back into the conversation untouched, because the next turn needs to
 * see it exactly as it was.
 */
export function readReply(content: Anthropic.ContentBlock[]): BrainReply {
  let text = "";
  const calls: BrainToolCall[] = [];

  for (const block of content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      calls.push({
        id: block.id,
        name: block.name,
        // The loop downstream parses JSON, and the SDK has already parsed it —
        // so put it back rather than teaching the loop two shapes.
        args: JSON.stringify(block.input ?? {}),
      });
    }
  }

  return { content: text, calls };
}

export class AnthropicBrain implements Brain {
  private client: Anthropic;
  private system: string;
  private tools: ReturnType<typeof toAnthropicTools>;
  private messages: Anthropic.MessageParam[];
  /** Kept so a tool round can be recorded exactly as Claude wrote it. */
  private lastContent: Anthropic.ContentBlock[] = [];

  constructor(input: BrainInput) {
    this.client = anthropicClient();
    this.system = input.system;
    this.tools = toAnthropicTools(input.tools);
    this.messages = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  async turn(onText: (delta: string) => void): Promise<BrainReply> {
    const stream = this.client.messages.stream({
      model: anthropicModel(),
      max_tokens: getMaxTokens(),
      system: this.system,
      messages: this.messages,
      ...(this.tools.length > 0 ? { tools: this.tools } : {}),
      output_config: { effort: anthropicEffort() },
    });

    // Spoken as it is written. The whole point of streaming here is that he
    // starts talking while the rest of the sentence is still arriving.
    stream.on("text", onText);

    const message = await stream.finalMessage();

    // A safety decline is a real outcome, not an error: it arrives as a normal
    // 200 with nothing useful in `content`, so say so rather than going quiet.
    if (message.stop_reason === "refusal") {
      const why = message.stop_details?.explanation;
      throw new Error(
        `Claude declined to answer that one, sir${why ? ` — ${why}` : ""}.`
      );
    }

    this.lastContent = message.content;
    return readReply(message.content);
  }

  record(reply: BrainReply, results: string[]): void {
    // Claude's own words go back verbatim — thinking blocks and server-tool
    // results included. Rebuilding them from the text would lose the parts the
    // next turn needs.
    this.messages.push({ role: "assistant", content: this.lastContent });
    this.messages.push({
      role: "user",
      content: reply.calls.map((call, i) => ({
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: results[i],
      })),
    });
  }
}
