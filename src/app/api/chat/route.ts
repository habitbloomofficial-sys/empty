import { NextRequest, NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { AnthropicBrain } from "@/lib/anthropicBrain";
import { OpenAIBrain } from "@/lib/openAiBrain";
import { describeModelFailure } from "@/lib/modelErrors";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { availableTools, executeTool } from "@/lib/tools";
import { logRecap } from "@/lib/sessions";
import { describeDevice } from "@/lib/device";
import { recapLine } from "@/lib/sessionFormat";
import type { Brain } from "@/lib/brain";
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

  // Which machine he is reading this on — desktop actions land on the computer
  // Axis runs on, which is not always the one in his hand.
  const deviceLabel = describeDevice(
    req.headers.get("user-agent"),
    !req.headers.get("x-forwarded-for")
  ).label;

  // Whichever brain is configured, spoken to in its own language. Everything
  // below this line is the same for all of them.
  let brain: Brain;
  try {
    const input = {
      system: buildSystemPrompt(new Date(), deviceLabel),
      messages: incoming.map((m) => ({ role: m.role, content: m.content })),
      tools: availableTools(),
    };
    brain =
      getAIProvider() === "anthropic" ? new AnthropicBrain(input) : new OpenAIBrain(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }

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
          const reply = await brain.turn((delta) => send({ type: "text", delta }));
          modelMs += Date.now() - modelStart;

          if (reply.calls.length === 0) {
            recordTurn(actions);
            send({
              type: "done",
              reply: reply.content,
              actions,
              timings: { model: modelMs, tools: toolMs, total: Date.now() - startedAt },
            });
            return;
          }

          const toolStart = Date.now();
          const outcomes = await Promise.all(
            reply.calls.map((call) => executeTool(call.name, call.args))
          );
          toolMs += Date.now() - toolStart;

          for (const outcome of outcomes) {
            actions.push(outcome.log);
            // Sent as it happens: the action is already done on the user's
            // machine, so the UI shouldn't wait for the closing sentence.
            send({ type: "action", log: outcome.log });
          }

          brain.record(
            reply,
            outcomes.map((outcome) => JSON.stringify(outcome.result))
          );
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
