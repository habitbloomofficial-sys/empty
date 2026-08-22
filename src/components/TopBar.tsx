"use client";

import { BrainIcon, HologramIcon, MailIcon, SettingsIcon, WhatsAppIcon } from "./Icons";
import { StatusChip } from "./StatusChip";
import type { IntegrationStatus } from "@/lib/types";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai: "OpenAI",
};

export function TopBar({
  status,
  onOpenSettings,
  onOpenHologram,
}: {
  status: IntegrationStatus | null;
  onOpenSettings: () => void;
  onOpenHologram: () => void;
}) {
  const online = Boolean(status?.brain);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-amber-500/[0.13] bg-gradient-to-b from-[rgba(8,8,8,0.92)] to-[rgba(2,2,2,0.55)] px-4 backdrop-blur-md sm:px-5">
      <div className="flex items-center gap-3.5">
        {/* The Axis mark: a bracketed square with a core that breathes while
            he's connected, and sits dark when he has no brain. */}
        <div className="grid h-[22px] w-[22px] place-items-center border border-amber-400/50 shadow-[inset_0_0_14px_rgba(255,122,0,0.18)]">
          <div
            className={
              online
                ? "h-1.5 w-1.5 animate-blink bg-amber-300 shadow-[0_0_8px_#ff7a00]"
                : "h-1.5 w-1.5 bg-sand-700"
            }
          />
        </div>

        <div className="flex flex-col gap-[3px]">
          <div className="text-[15px] font-medium leading-none tracking-[0.42em] text-cream">
            AXIS
          </div>
          {/* Wraps to two lines on a phone at the full wording, which throws
              the header out; the short form says the same thing. */}
          <div className="ax-label whitespace-nowrap text-[8px] leading-none">
            <span className="sm:hidden">{online ? "ONLINE" : "STANDBY"}</span>
            <span className="hidden sm:inline">
              {online ? "ONLINE • SYSTEM OPERATIONAL" : "STANDBY • NO BRAIN CONNECTED"}
            </span>
          </div>
        </div>

        {status?.device && status.device.kind !== "computer" && (
          <div className="ml-2 hidden border-l border-amber-500/[0.13] pl-3 sm:block">
            <span className="ax-label">LINK / {status.device.kind}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <StatusChip
          ok={online}
          icon={<BrainIcon className="h-3.5 w-3.5" />}
          label={PROVIDER_LABEL[status?.brainProvider ?? ""] ?? "Brain"}
        />
        <StatusChip
          ok={Boolean(status?.gmail)}
          icon={<MailIcon className="h-3.5 w-3.5" />}
          label="Email"
        />
        <StatusChip
          ok={Boolean(status?.whatsapp)}
          icon={<WhatsAppIcon className="h-3.5 w-3.5" />}
          label="WhatsApp"
        />
        <button
          onClick={onOpenHologram}
          className="flex h-8 w-8 items-center justify-center border border-transparent text-sand-500 transition hover:border-amber-500/25 hover:text-amber-400"
          aria-label="Open Hologram v3"
          title="Hologram v3"
        >
          <HologramIcon className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center border border-transparent text-sand-500 transition hover:border-amber-500/25 hover:text-amber-400"
          aria-label="Settings"
        >
          <SettingsIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
