import { NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { AnthropicBrain } from "@/lib/anthropicBrain";
import { OpenAIBrain } from "@/lib/openAiBrain";
import { userTitle } from "@/lib/address";
import { NOTICE_SYSTEM, decideNotice, markSaid, noticePrompt } from "@/lib/notice";
import type { Brain } from "@/lib/brain";

export const runtime = "nodejs";

// "Anything worth saying?" — asked by the page every minute, and almost always
// answered with no. Everything that decides *whether* and *what* lives in
// notice.ts; this is the wire between it and a brain.

export async function POST() {
  const decision = await decideNotice();
  if (decision.status !== "speak") {
    return NextResponse.json({ say: null, reason: decision.status });
  }

  const { notices } = decision;
  const keys = notices.map((notice) => notice.key);

  let brain: Brain;
  try {
    const input = {
      system: NOTICE_SYSTEM,
      parts: { stable: NOTICE_SYSTEM, volatile: "" },
      messages: [{ role: "user" as const, content: noticePrompt(notices, userTitle()) }],
      tools: [],
    };
    brain = getAIProvider() === "anthropic" ? new AnthropicBrain(input) : new OpenAIBrain(input);
  } catch {
    return NextResponse.json({ say: null, reason: "no-brain" });
  }

  let said: string;
  try {
    said = (await brain.turn(() => {})).content.trim();
  } catch {
    // A model that won't answer means he stays quiet. A remark nobody asked for
    // is not worth an error on screen.
    return NextResponse.json({ say: null, reason: "failed" });
  }

  // Marked either way: he decided there was nothing in these facts, and
  // reconsidering the same non-event every twenty minutes would be pointless.
  markSaid(keys);

  if (!said || /^skip\b/i.test(said)) {
    return NextResponse.json({ say: null, reason: "skipped" });
  }
  return NextResponse.json({ say: said, kinds: notices.map((notice) => notice.kind) });
}
