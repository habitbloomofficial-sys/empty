"use client";

import { BrainIcon, MailIcon, SettingsIcon, WhatsAppIcon } from "./Icons";
import { StatusChip } from "./StatusChip";
import type { IntegrationStatus } from "@/lib/types";

export function TopBar({
  status,
  onOpenSettings,
}: {
  status: IntegrationStatus | null;
  onOpenSettings: () => void;
}) {
  return (
    <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-b-2xl px-5 py-3 sm:px-8">
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 rounded-full ${
            status?.brain
              ? "bg-sky-500 shadow-[0_0_8px_3px_rgba(14,165,233,0.55)]"
              : "bg-slate-300"
          }`}
        />
        <h1 className="font-display text-lg font-semibold tracking-[0.18em] text-ink-900">
          JARVIS
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <StatusChip
          ok={Boolean(status?.brain)}
          icon={<BrainIcon className="h-4 w-4" />}
          label={status?.brainProvider === "gemini" ? "Gemini" : status?.brainProvider === "openai" ? "OpenAI" : "Brain"}
        />
        <StatusChip ok={Boolean(status?.gmail)} icon={<MailIcon className="h-4 w-4" />} label="Email" />
        <StatusChip ok={Boolean(status?.whatsapp)} icon={<WhatsAppIcon className="h-4 w-4" />} label="WhatsApp" />
        <button
          onClick={onOpenSettings}
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-sky-700 transition hover:bg-sky-500/10"
          aria-label="Settings"
        >
          <SettingsIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
