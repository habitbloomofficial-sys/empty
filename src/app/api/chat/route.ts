import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getAI, getAIModel, getReasoningEffort, isUnsupportedParameter } from "@/lib/ai";
import { adoptGeminiReplacement, isModelNotFound } from "@/lib/geminiModel";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { availableTools, executeTool, TOOL_NAMES } from "@/lib/tools";
import { normalizeToolName } from "@/lib/toolCalls";
import type { ActionLogEntry } from "@/lib/types";

export const runtime = "nodejs";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TOOL_ROUNDS = 5;

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
  let sendReasoningEffort = true;

  function request(): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
    const effort = sendReasoningEffort ? getReasoningEffort() : null;
    return {
      model: getAIModel(),
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
      ...(effort ? ({ reasoning_effort: effort } as Record<string, unknown>) : {}),
    };
  }

  // The SDK awaits response headers before returning the stream, so a retired
  // model or an unsupported parameter still surfaces here, not mid-stream.
  async function openStream() {
    try {
      return await ai.chat.completions.create(request());
    } catch (err) {
      if (isUnsupportedParameter(err, "reasoning_effort")) {
        sendReasoningEffort = false;
        return ai.chat.completions.create(request());
      }
      if (isModelNotFound(err) && adoptGeminiReplacement(err)) {
        return ai.chat.completions.create(request());
      }
      throw err;
    }
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

        send({
          type: "done",
          reply: "I've taken several steps but need a moment more, sir — could you ask me to continue?",
          actions,
          timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
        });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
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
