import type { ReactNode } from "react";

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
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        ok
          ? "bg-sky-500/10 text-sky-700"
          : "bg-slate-400/10 text-slate-400"
      }`}
      title={ok ? `${label} connected` : `${label} not connected`}
    >
      <span className={ok ? "text-sky-500" : "text-slate-400"}>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok ? "bg-sky-500 shadow-[0_0_6px_2px_rgba(14,165,233,0.5)]" : "bg-slate-300"
        }`}
      />
    </div>
  );
}
