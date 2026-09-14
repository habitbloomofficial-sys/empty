import { NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { AnthropicBrain } from "@/lib/anthropicBrain";
import { OpenAIBrain } from "@/lib/openAiBrain";
import { userTitle } from "@/lib/address";
import { NOTICE_SYSTEM, decideNotice, markSaid, noticePrompt } from "@/lib/notice";
import { decideInitiative, markActed } from "@/lib/initiative";
import { openWebsite } from "@/lib/desktop";
import type { Brain } from "@/lib/brain";

export const runtime = "nodejs";

// "Anything worth saying?" — asked by the page every minute, and almost always
// answered with no. Everything that decides *whether* and *what* lives in
// notice.ts; this is the wire between it and a brain.

export async function POST(request: Request) {
  // The page knows two things this does not: whether he asked for quiet, and
  // whether he is mid-sentence. Both are reasons not to speak up unasked.
  let context: { standby?: boolean; talking?: boolean } = {};
  try {
    context = (await request.json()) as typeof context;
  } catch {
    // No body is fine — it means neither.
  }

  const decision = await decideNotice();
  if (decision.status !== "speak") {
    // Nothing of his own to report. This is the moment to consider whether
    // anything in the world is worth mentioning — never the other way round,
    // because his own overdue invoice outranks any trailer ever made.
    const impulse = await considerInitiative(context);
    if (impulse) return NextResponse.json(impulse);
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

/**
 * Something he has not asked about, that he might want anyway.
 *
 * Everything that decides WHETHER is in initiative.ts, behind five gates and
 * off by default. What is left here is the doing: say the line, and — only for
 * an unusually strong match — put it on screen.
 *
 * It says what it did in the same breath as doing it. An action taken silently
 * is indistinguishable from a bug, and this is the one part of Jarvis that
 * moves without being asked.
 */
async function considerInitiative(context: { standby?: boolean; talking?: boolean }) {
  const decision = await decideInitiative(context);
  if (decision.status !== "act") return null;

  const { impulse } = decision;
  // Marked before opening anything: if the open throws, the cooling-off period
  // has still started and he is not offered the same thing again in a minute.
  markActed(impulse.item.id);

  let opened = false;
  if (impulse.openIt) {
    try {
      await openWebsite({ url: impulse.item.url, newWindow: true });
      opened = true;
    } catch {
      // Desktop control off, or no browser. The remark still stands.
    }
  }

  const because = impulse.because.slice(0, 2).join(" and ");
  const say = opened
    ? `"${impulse.item.title}" has just gone up, sir — you follow ${because}, so I have put it on screen.`
    : `"${impulse.item.title}" has just gone up on ${impulse.item.channel}, sir. You follow ${because}, if you want it.`;

  return { say, kinds: ["trending"], opened, url: impulse.item.url };
}
