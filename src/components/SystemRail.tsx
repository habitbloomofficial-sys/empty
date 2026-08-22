"use client";

import type { IntegrationStatus, OrbState } from "@/lib/types";

/**
 * The instrument rail from the design, down the right-hand edge.
 *
 * Every reading on it is something Axis actually knows. The original mockup
 * had CPU, GPU and temperature gauges, and those are omitted deliberately:
 * this app does not measure them, and a dial showing a number nobody computed
 * is worse than no dial — it teaches you to distrust the ones that are real.
 * What is here instead is what he genuinely has, which turns out to be the
 * more interesting half anyway.
 *
 * Hidden below xl, where the screen belongs to the conversation.
 */

function Reading({
  label,
  value,
  lit,
}: {
  label: string;
  value: string;
  /** Amber when it is a live capability, muted when it isn't. */
  lit?: boolean;
}) {
  return (
    <div className="border-t border-amber-500/[0.13] px-3 py-2.5 first:border-t-0">
      <div className="ax-label mb-1 text-[8px]">{label}</div>
      <div
        className={`font-mono text-[13px] leading-none ${
          lit === false ? "text-sand-700" : "text-cream"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

const PROVIDER: Record<string, string> = {
  gemini: "GEMINI",
  openrouter: "OPENROUTER",
  openai: "OPENAI",
};

// He can always read a page; searching is the part that needs a key. "READ
// ONLY" says that in two words rather than implying he is cut off.
const SEARCH: Record<"google" | "gemini" | "openrouter", string> = {
  google: "GOOGLE",
  gemini: "GEMINI",
  openrouter: "OPENROUTER",
};

const STATE_LABEL: Record<OrbState, string> = {
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "WORKING",
  speaking: "SPEAKING",
};

export function SystemRail({
  status,
  state,
  sessionDate,
}: {
  status: IntegrationStatus | null;
  state: OrbState;
  sessionDate: string | null;
}) {
  const roots = status?.fileRoots?.length ?? 0;

  return (
    <aside className="pointer-events-none fixed right-0 top-[52px] z-10 hidden h-[calc(100vh-52px)] w-[224px] flex-col border-l border-amber-500/[0.13] bg-gradient-to-l from-[rgba(6,6,6,0.85)] to-transparent xl:flex">
      <div className="flex items-center justify-between border-b border-amber-500/[0.13] px-3 py-2.5">
        <span className="ax-label ax-label-amber">SYSTEM</span>
        <span className="ax-label text-[8px]">01</span>
      </div>

      <Reading label="STATE" value={STATE_LABEL[state]} />
      <Reading
        label="BRAIN"
        value={status?.brain ? (PROVIDER[status.brainProvider ?? ""] ?? "READY") : "NONE"}
        lit={Boolean(status?.brain)}
      />
      <Reading
        label="VOICE"
        value={status?.elevenlabs ? "ELEVENLABS" : "BROWSER"}
        lit={Boolean(status?.elevenlabs)}
      />
      <Reading
        label="EARS"
        value={status?.transcription ? "READY" : "BROWSER"}
        lit={Boolean(status?.transcription)}
      />

      <div className="mt-4 flex items-center justify-between border-y border-amber-500/[0.13] px-3 py-2.5">
        <span className="ax-label ax-label-amber">MEMORY CORE</span>
      </div>
      <Reading label="FACTS HELD" value={String(status?.memories ?? 0)} lit={(status?.memories ?? 0) > 0} />
      <Reading
        label="LEARNED"
        value={String(status?.learned ?? 0)}
        lit={(status?.learned ?? 0) > 0}
      />
      <Reading
        label="DAYS LOGGED"
        value={String(status?.sessionDays ?? 0)}
        lit={(status?.sessionDays ?? 0) > 0}
      />
      <Reading label="SESSION" value={sessionDate ?? "—"} />

      <div className="mt-4 flex items-center justify-between border-y border-amber-500/[0.13] px-3 py-2.5">
        <span className="ax-label ax-label-amber">REACH</span>
      </div>
      <Reading label="FOLDERS" value={roots > 0 ? `${roots} SEARCHABLE` : "OFF"} lit={roots > 0} />
      <Reading
        label="DESKTOP"
        value={status?.desktopControl ? "ALLOWED" : "BLOCKED"}
        lit={Boolean(status?.desktopControl)}
      />
      <Reading
        label="WEB"
        value={status?.webSearch ? SEARCH[status.webSearch] : "READ ONLY"}
        lit={Boolean(status?.webSearch)}
      />
      <Reading label="LINK" value={(status?.device?.kind ?? "computer").toUpperCase()} />

      <div className="mt-auto border-t border-amber-500/[0.13] px-3 py-3">
        <div className="ax-label text-[8px]">AXIS CORE</div>
        <div className="ax-label mt-1 text-[8px]">
          {status?.brain ? "ALL SYSTEMS NOMINAL" : "AWAITING A BRAIN"}
        </div>
      </div>
    </aside>
  );
}
