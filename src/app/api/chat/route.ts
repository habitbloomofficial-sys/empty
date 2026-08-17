import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getAI, getAIModel } from "@/lib/ai";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { toolDefinitions, executeTool } from "@/lib/tools";
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

  let ai;
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

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await ai.chat.completions.create({
        model: getAIModel(),
        messages,
        tools: toolDefinitions,
      });

      const choice = completion.choices[0];
      const message = choice.message;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return NextResponse.json({
          reply: message.content ?? "",
          actions,
        });
      }

      messages.push(message);

      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const { result, log } = await executeTool(call.function.name, call.function.arguments);
        actions.push(log);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return NextResponse.json({
      reply: "I've taken several steps but need a moment more, sir — could you ask me to continue?",
      actions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
