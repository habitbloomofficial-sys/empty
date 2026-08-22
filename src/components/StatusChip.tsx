import type { ReactNode } from "react";

/**
 * One integration, and whether it is actually connected.
 *
 * Deliberately reads as instrumentation rather than decoration: a square lamp
 * that is lit or dark, and a mono label. Nothing here is ever shown as
 * connected when it isn't — the panel is only worth having if it tells the
 * truth about what he can currently do.
 */
export function StatusChip({
  ok,
  icon,
  label,
}: {
  ok: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 border px-2 py-1 transition-colors ${
        ok
          ? "border-amber-500/35 bg-amber-500/[0.07] text-amber-400"
          : "border-white/[0.06] text-sand-700"
      }`}
      title={ok ? `${label} connected` : `${label} not connected`}
    >
      <span className={ok ? "text-amber-400" : "text-sand-700"}>{icon}</span>
      <span className="ax-label hidden sm:inline" style={{ color: "inherit" }}>
        {label}
      </span>
      <span
        className={`h-1.5 w-1.5 ${
          ok ? "bg-amber-300 shadow-[0_0_8px_rgba(255,122,0,0.9)]" : "bg-sand-700/50"
        }`}
      />
    </div>
  );
}
