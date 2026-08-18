import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getAI, getAIModel, getReasoningEffort, isUnsupportedParameter } from "@/lib/ai";
import { adoptGeminiReplacement, isModelNotFound } from "@/lib/geminiModel";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { availableTools, executeTool } from "@/lib/tools";
import type { ActionLogEntry } from "@/lib/types";

export const runtime = "nodejs";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TOOL_ROUNDS = 5;

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
    ...incoming.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam)),
  ];

  const actions: ActionLogEntry[] = [];

  // Whether the endpoint accepted reasoning_effort. Remembered for the life of
  // the process so an endpoint that rejects it is only probed once.
  let sendReasoningEffort = true;

  const tools = availableTools();

  function request(): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const effort = sendReasoningEffort ? getReasoningEffort() : null;
    return {
      model: getAIModel(),
      messages,
      // Omitted entirely when nothing is connected — an empty array is not
      // the same thing to every endpoint.
      ...(tools.length > 0 ? { tools } : {}),
      ...(effort
        ? // Not in the SDK's union for every provider, but Gemini's
          // OpenAI-compatible endpoint reads it.
          ({ reasoning_effort: effort } as Record<string, unknown>)
        : {}),
    };
  }

  // Two things can go wrong on the first call and be worth one retry: Google
  // retired the model (the 404 names its replacement), or this endpoint
  // doesn't understand reasoning_effort.
  async function complete() {
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

  const startedAt = Date.now();
  let modelMs = 0;
  let toolMs = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const modelStart = Date.now();
      const completion = await complete();
      modelMs += Date.now() - modelStart;

      const choice = completion.choices[0];
      const message = choice.message;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return NextResponse.json({
          reply: message.content ?? "",
          actions,
          timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
        });
      }

      messages.push(message);

      // Tool calls in one round are independent of each other, so run them
      // together rather than waiting for each in turn.
      const toolStart = Date.now();
      const calls = message.tool_calls.filter((call) => call.type === "function");
      const outcomes = await Promise.all(
        calls.map((call) => executeTool(call.function.name, call.function.arguments))
      );
      toolMs += Date.now() - toolStart;

      calls.forEach((call, i) => {
        actions.push(outcomes[i].log);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcomes[i].result),
        });
      });
    }

    return NextResponse.json({
      reply: "I've taken several steps but need a moment more, sir — could you ask me to continue?",
      actions,
      timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
