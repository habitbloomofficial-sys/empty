"use client";

import { BrainIcon, ChatIcon, CloseIcon, MailIcon, WhatsAppIcon } from "./Icons";
import type { IntegrationStatus } from "@/lib/types";

function Row({
  icon,
  title,
  ok,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/40 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sky-600">{icon}</span>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ok ? "bg-sky-500/15 text-sky-700" : "bg-slate-400/15 text-slate-500"
          }`}
        >
          {ok ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="text-xs leading-relaxed text-ink-700/70">{children}</div>
    </div>
  );
}

export function SettingsModal({
  status,
  onClose,
}: {
  status: IntegrationStatus | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-sky-950/20 backdrop-blur-sm p-4">
      <div className="glass-strong w-full max-w-lg rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-900">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-700 hover:bg-sky-500/10"
            aria-label="Close settings"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Row icon={<BrainIcon className="h-4 w-4" />} title="AI brain" ok={Boolean(status?.brain)}>
            {status?.brain ? (
              `JARVIS is thinking with ${status.brainProvider === "gemini" ? "Gemini" : "OpenAI"}.`
            ) : (
              <div className="space-y-1">
                <p>Add ONE of these to .env.local and restart the server:</p>
                <p>
                  <code className="rounded bg-sky-500/10 px-1 py-0.5">OPENAI_API_KEY</code> — an
                  OpenAI key, or
                </p>
                <p>
                  <code className="rounded bg-sky-500/10 px-1 py-0.5">GEMINI_API_KEY</code> — a
                  free Google AI Studio key.
                </p>
              </div>
            )}
          </Row>

          <Row icon={<ChatIcon className="h-4 w-4" />} title="ElevenLabs voice" ok={Boolean(status?.elevenlabs)}>
            {status?.elevenlabs
              ? "JARVIS will speak replies aloud."
              : "Add ELEVENLABS_API_KEY to .env.local to hear JARVIS speak."}
          </Row>

          <Row icon={<MailIcon className="h-4 w-4" />} title="Gmail" ok={Boolean(status?.gmail)}>
            {status?.gmail ? (
              "JARVIS can search, read, draft, and send email on your behalf."
            ) : (
              <div className="space-y-2">
                <p>
                  Requires a Google Cloud OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
                  in .env.local — see README).
                </p>
                <a
                  href="/api/gmail/auth"
                  className="inline-block rounded-full bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600"
                >
                  Connect Gmail
                </a>
              </div>
            )}
          </Row>

          <Row icon={<WhatsAppIcon className="h-4 w-4" />} title="WhatsApp" ok={Boolean(status?.whatsapp)}>
            {status?.whatsapp
              ? "JARVIS can send WhatsApp messages via Twilio."
              : "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM to .env.local — see README."}
          </Row>
        </div>

        <p className="mt-4 text-[11px] text-ink-700/50">
          All credentials live only in your local .env.local file and are never sent to the browser.
        </p>
      </div>
    </div>
  );
}
