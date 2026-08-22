import OpenAI from "openai";
import {
  adoptAffordableLimit,
  getAI,
  getAIModel,
  getMaxTokens,
  getReasoningEffort,
  isPaymentRequired,
} from "./ai";
import { adoptGeminiReplacement, isModelNotFound } from "./geminiModel";
import { normalizeToolName } from "./toolCalls";
import { TOOL_NAMES } from "./tools";
import type { Brain, BrainInput, BrainReply, BrainToolCall } from "./brain";

// OpenAI, Gemini and OpenRouter, which all speak chat-completions.
//
// This is the code Axis has always run; it moved here so the tool loop could be
// written once and shared with Anthropic, which does not speak it.

/** One accumulating tool call, reassembled from streamed fragments. */
interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

export class OpenAIBrain implements Brain {
  private ai: OpenAI;
  private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  private tools: BrainInput["tools"];
  private variants: Record<string, unknown>[];
  private variantIndex = 0;

  constructor(input: BrainInput) {
    this.ai = getAI();
    this.tools = input.tools;
    this.messages = [
      { role: "system", content: input.system },
      ...input.messages.map(
        (m) =>
          ({
            role: m.role,
            content: m.content,
          }) as OpenAI.Chat.Completions.ChatCompletionMessageParam
      ),
    ];
    this.variants = optionalFieldVariants();
  }

  private request(): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
    return {
      model: getAIModel(),
      messages: this.messages,
      stream: true,
      // Always capped. Left unset, providers assume the model's own maximum
      // and OpenRouter refuses the request if the balance couldn't cover a
      // reply that long — even when the real answer is one sentence.
      max_tokens: getMaxTokens(),
      ...(this.tools.length > 0 ? { tools: this.tools } : {}),
      ...this.variants[this.variantIndex],
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  }

  /**
   * The SDK awaits response headers before returning the stream, so a retired
   * model or a refused field surfaces here rather than mid-stream.
   */
  private async open() {
    // Bounded: each pass either advances the variant or adopts a new model,
    // and both run out.
    for (let attempt = 0; attempt < this.variants.length + 2; attempt++) {
      try {
        return await this.ai.chat.completions.create(this.request());
      } catch (err) {
        if (isModelNotFound(err) && adoptGeminiReplacement(err)) continue;
        // Refused on cost: the provider says what the balance can afford, so
        // take that number and ask again rather than failing the turn.
        if (isPaymentRequired(err) && adoptAffordableLimit(err)) continue;
        // Gemini returns streaming errors as a JSON array, which the SDK can't
        // read — so the reason is often literally "400 status code (no body)".
        // Matching on the message is therefore hopeless; step down on any 400.
        if (isBadRequest(err) && this.variantIndex < this.variants.length - 1) {
          this.variantIndex++;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      "I couldn't get a reply from the model, sir — every request shape was refused."
    );
  }

  async turn(onText: (delta: string) => void): Promise<BrainReply> {
    const completion = await this.open();

    let content = "";
    const partials = new Map<number, PartialToolCall>();

    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        onText(delta.content);
      }

      for (const call of delta.tool_calls ?? []) {
        const partial = partials.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) partial.id = call.id;
        if (call.function?.name) partial.name += call.function.name;
        if (call.function?.arguments) partial.args += call.function.arguments;
        partials.set(call.index, partial);
      }
    }

    // Providers that resend a whole tool call rather than streaming it in
    // pieces leave the name doubled up; collapse it before use.
    const calls: BrainToolCall[] = [...partials.values()]
      .map((call) => ({ ...call, name: normalizeToolName(call.name, TOOL_NAMES) }))
      .filter((call) => call.name);

    return { content, calls };
  }

  record(reply: BrainReply, results: string[]): void {
    this.messages.push({
      role: "assistant",
      content: reply.content || null,
      tool_calls: reply.calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.args },
      })),
    });

    reply.calls.forEach((call, i) => {
      this.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: results[i],
      });
    });
  }
}

/** A rejected request, as opposed to a network or server failure. */
function isBadRequest(error: unknown): boolean {
  return (error as { status?: number })?.status === 400;
}

/**
 * Optional request fields, in the order they're worth trying. Providers
 * disagree about which of these they accept, and the disagreement arrives as
 * a bare 400 — so rather than predicting it, ask for what's wanted first and
 * step down until something is accepted.
 */
function optionalFieldVariants(): Record<string, unknown>[] {
  const effort = getReasoningEffort();
  const variants: Record<string, unknown>[] = [];
  if (effort) {
    variants.push({ reasoning_effort: effort });
    // "low" is understood everywhere reasoning_effort exists at all.
    if (effort !== "low") variants.push({ reasoning_effort: "low" });
  }
  // Nothing optional whatsoever: the request every implementation accepts.
  variants.push({});
  return variants;
}
