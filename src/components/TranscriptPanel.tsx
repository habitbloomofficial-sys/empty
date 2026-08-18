"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, ReplyTimings } from "@/lib/types";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Where the wait actually went. Cheap to show, and it turns "JARVIS feels
 * slow" into a specific stage worth looking at.
 */
function Timings({ timings }: { timings: ReplyTimings }) {
  const parts: string[] = [];
  if (timings.transcribe) parts.push(`heard ${seconds(timings.transcribe)}`);
  if (timings.model) parts.push(`thought ${seconds(timings.model)}`);
  if (timings.tools) parts.push(`tools ${seconds(timings.tools)}`);
  if (timings.speak) parts.push(`spoke ${seconds(timings.speak)}`);
  if (parts.length === 0) return null;

  return (
    <p className="mt-1.5 text-[10px] text-ink-700/40">
      {parts.join(" · ")}
      {timings.total ? ` · ${seconds(timings.total)} total` : ""}
    </p>
  );
}

export function TranscriptPanel({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-700/60">
        Speak or type below to begin, sir.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
              m.role === "user"
                ? "rounded-br-sm bg-sky-500 text-white"
                : "glass rounded-bl-sm text-ink-900"
            }`}
          >
            {m.role === "assistant" && (
              <div className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-sky-600">
                JARVIS
              </div>
            )}
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.timings && <Timings timings={m.timings} />}
            {m.actions && m.actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.actions.map((a, i) => (
                  <span
                    key={i}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      a.ok
                        ? "bg-sky-500/10 text-sky-700"
                        : "bg-rose-500/10 text-rose-600"
                    }`}
                  >
                    {a.ok ? "✓" : "✕"} {a.summary}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
