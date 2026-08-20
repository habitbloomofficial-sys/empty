import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  adoptAffordableLimit,
  getAI,
  getAIModel,
  getAIProvider,
  getMaxTokens,
  getReasoningEffort,
  isPaymentRequired,
} from "@/lib/ai";
import { adoptGeminiReplacement, isModelNotFound } from "@/lib/geminiModel";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { availableTools, executeTool, TOOL_NAMES } from "@/lib/tools";
import { normalizeToolName } from "@/lib/toolCalls";
import { logRecap } from "@/lib/sessions";
import { recapLine } from "@/lib/sessionFormat";
import type { ActionLogEntry } from "@/lib/types";

export const runtime = "nodejs";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TOOL_ROUNDS = 5;

/**
 * Model failures reach the user, so they have to say something. The SDK's own
 * wording for a rejected request is "400 status code (no body)", which tells
 * nobody anything.
 */
function describeModelFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number })?.status;

  if (status === 401 || status === 403 || /api[_ ]key/i.test(message)) {
    return "The AI provider refused my key, sir — check it in Settings.";
  }
  if (status === 429 || /quota|rate.?limit|RateLimitReached/i.test(message)) {
    return getAIProvider() === "github"
      ? "GitHub is rate limiting me, sir — its free tier caps requests per minute and per day. A moment, or pick a smaller model in Settings."
      : "The AI provider is rate limiting me, sir — a moment and try again.";
  }
  if (status === 400 && /no body/i.test(message)) {
    return "The AI provider rejected the request, sir, without saying why. Worth a retry, or check the model name in Settings.";
  }
  if (status === 402 || /more credits|can only afford/i.test(message)) {
    return "Your OpenRouter balance won't cover a reply, sir — add credit at openrouter.ai/settings/credits, or pick a cheaper model in Settings.";
  }
  if (status && status >= 500) {
    return "The AI provider is having trouble at their end, sir — try again shortly.";
  }
  return message;
}

/** One accumulating tool call, reassembled from streamed fragments. */
interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

export async function POST(req: NextRequest) {
  let body: { messages?: IncomingMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming = body.messages ?? [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  let ai: OpenAI;
  try {
    ai = getAI();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...incoming.map(
      (m) =>
        ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam
    ),
  ];

  const tools = availableTools();

  // What he asked for this turn, kept for the session log below.
  const askedFor = [...incoming].reverse().find((m) => m.role === "user")?.content ?? "";

  /**
   * Write the turn into today's session log. Done here rather than in the
   * tools, so one line describes the whole exchange — what was asked and what
   * came of it — which is what makes the log readable weeks later.
   */
  function recordTurn(actions: ActionLogEntry[]): void {
    try {
      const line = recapLine(askedFor, actions);
      if (line) logRecap(line);
    } catch {
      // A memory that can't be written must never cost him his reply.
    }
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

  const variants = optionalFieldVariants();
  let variantIndex = 0;

  function request(): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
    return {
      model: getAIModel(),
      messages,
      stream: true,
      // Always capped. Left unset, providers assume the model's own maximum
      // and OpenRouter refuses the request if the balance couldn't cover a
      // reply that long — even when the real answer is one sentence.
      max_tokens: getMaxTokens(),
      ...(tools.length > 0 ? { tools } : {}),
      ...variants[variantIndex],
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  }

  /** A rejected request, as opposed to a network or server failure. */
  function isBadRequest(error: unknown): boolean {
    return (error as { status?: number })?.status === 400;
  }

  // The SDK awaits response headers before returning the stream, so a retired
  // model or a refused field surfaces here rather than mid-stream.
  async function openStream() {
    // Bounded: each pass either advances the variant or adopts a new model,
    // and both run out.
    for (let attempt = 0; attempt < variants.length + 2; attempt++) {
      try {
        return await ai.chat.completions.create(request());
      } catch (err) {
        if (isModelNotFound(err) && adoptGeminiReplacement(err)) continue;
        // Refused on cost: the provider says what the balance can afford, so
        // take that number and ask again rather than failing the turn.
        if (isPaymentRequired(err) && adoptAffordableLimit(err)) continue;
        // Gemini returns streaming errors as a JSON array, which the SDK can't
        // read — so the reason is often literally "400 status code (no body)".
        // Matching on the message is therefore hopeless; step down on any 400.
        if (isBadRequest(err) && variantIndex < variants.length - 1) {
          variantIndex++;
          continue;
        }
        throw err;
      }
    }
    throw new Error("I couldn't get a reply from the model, sir — every request shape was refused.");
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  // Newline-delimited JSON: each line is one complete event, so the client can
  // act on text the moment it arrives instead of waiting for the whole reply.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      const actions: ActionLogEntry[] = [];
      let modelMs = 0;
      let toolMs = 0;

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const modelStart = Date.now();
          const completion = await openStream();

          let content = "";
          const partials = new Map<number, PartialToolCall>();

          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              send({ type: "text", delta: delta.content });
            }

            for (const call of delta.tool_calls ?? []) {
              const partial = partials.get(call.index) ?? { id: "", name: "", args: "" };
              if (call.id) partial.id = call.id;
              if (call.function?.name) partial.name += call.function.name;
              if (call.function?.arguments) partial.args += call.function.arguments;
              partials.set(call.index, partial);
            }
          }
          modelMs += Date.now() - modelStart;

          // Providers that resend a whole tool call rather than streaming it
          // in pieces leave the name doubled up; collapse it before use.
          const calls = [...partials.values()]
            .map((call) => ({ ...call, name: normalizeToolName(call.name, TOOL_NAMES) }))
            .filter((call) => call.name);
          if (calls.length === 0) {
            recordTurn(actions);
            send({
              type: "done",
              reply: content,
              actions,
              timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
            });
            return;
          }

          messages.push({
            role: "assistant",
            content: content || null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.args },
            })),
          });

          const toolStart = Date.now();
          const outcomes = await Promise.all(
            calls.map((call) => executeTool(call.name, call.args))
          );
          toolMs += Date.now() - toolStart;

          calls.forEach((call, i) => {
            actions.push(outcomes[i].log);
            // Sent as it happens: the action is already done on the user's
            // machine, so the UI shouldn't wait for the closing sentence.
            send({ type: "action", log: outcomes[i].log });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(outcomes[i].result),
            });
          });
        }

        recordTurn(actions);
        send({
          type: "done",
          reply: "I've taken several steps but need a moment more, sir — could you ask me to continue?",
          actions,
          timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
        });
      } catch (err) {
        send({ type: "error", error: describeModelFailure(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
