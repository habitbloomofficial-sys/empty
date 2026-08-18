"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainIcon, ChatIcon, CloseIcon, MailIcon, WhatsAppIcon } from "./Icons";
import type { IntegrationStatus } from "@/lib/types";

interface SettingView {
  key: string;
  set: boolean;
  secret: boolean;
  display: string;
  source: "saved" | "env" | "unset";
}

interface KeyCheck {
  key: string;
  ok: boolean;
  message: string;
}

type Views = Record<string, SettingView>;

function Section({
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
      <div className="mb-2.5 flex items-center gap-2">
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
      <div className="space-y-2.5 text-xs leading-relaxed text-ink-700/70">{children}</div>
    </div>
  );
}

function Field({
  label,
  view,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  view: SettingView | undefined;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const secret = view?.secret ?? false;
  const savedHint = view?.set
    ? `Saved${view.source === "env" ? " (from .env.local)" : ""}: ${view.display}`
    : null;

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-ink-900">
        {label}
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 hover:bg-sky-500/10"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </span>
      <input
        type={secret && !revealed ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (view?.set ? view.display : "")}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-white/80 bg-white/70 px-3 py-2 font-mono text-xs text-ink-900 placeholder:font-sans placeholder:text-ink-700/35 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
      />
      {(hint || savedHint) && (
        <span className="mt-1 block text-[10px] text-ink-700/50">
          {hint ?? savedHint}
        </span>
      )}
    </label>
  );
}

function SaveButton({
  onClick,
  busy,
  saved,
  disabled,
  checks,
}: {
  onClick: () => void;
  busy: boolean;
  saved: boolean;
  disabled?: boolean;
  checks?: KeyCheck[];
}) {
  return (
    <div className="space-y-1.5 pt-0.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={busy || disabled}
          className="rounded-full bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Save"}
        </button>
        {saved && <span className="text-[11px] font-medium text-sky-700">Saved ✓</span>}
      </div>
      {checks?.map((check) => (
        <p
          key={check.key}
          className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
            check.ok ? "bg-sky-500/10 text-sky-800" : "bg-rose-500/10 text-rose-700"
          }`}
        >
          {check.ok ? "✓ " : "⚠ "}
          {check.message}
        </p>
      ))}
    </div>
  );
}

export function SettingsModal({
  status,
  onClose,
  onSaved,
}: {
  status: IntegrationStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [views, setViews] = useState<Views>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini");
  const [busySection, setBusySection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, KeyCheck[]>>({});
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySettings = useCallback((list: SettingView[]) => {
    const next: Views = {};
    for (const v of list) next[v.key] = v;
    setViews(next);
    // Non-secret values are safe to show in full, so seed the inputs with them.
    setDrafts((prev) => {
      const seeded = { ...prev };
      for (const v of list) {
        if (!v.secret && seeded[v.key] === undefined) seeded[v.key] = v.display;
      }
      return seeded;
    });
    const saved = next.AI_PROVIDER?.display?.toLowerCase();
    if (saved === "openai" || saved === "gemini") {
      setProvider(saved);
    } else if (next.OPENAI_API_KEY?.set && !next.GEMINI_API_KEY?.set) {
      setProvider("openai");
    } else if (next.GEMINI_API_KEY?.set) {
      setProvider("gemini");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.settings)) applySettings(data.settings);
      } catch {
        /* the panel still works for the fields the user types into */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  const draft = (key: string) => drafts[key] ?? "";
  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));

  async function save(section: string, updates: Record<string, string>) {
    setBusySection(section);
    setError(null);
    setSavedSection(null);
    setChecks((prev) => ({ ...prev, [section]: [] }));
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save those settings.");
      if (Array.isArray(data.settings)) applySettings(data.settings);
      if (Array.isArray(data.checks)) {
        setChecks((prev) => ({ ...prev, [section]: data.checks }));
      }
      // Clear the secret inputs — they're saved now, and the masked hint
      // underneath is the confirmation that they landed.
      setDrafts((prev) => {
        const cleared = { ...prev };
        for (const key of Object.keys(updates)) {
          if (views[key]?.secret ?? true) cleared[key] = "";
        }
        return cleared;
      });
      setSavedSection(section);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySection(null);
    }
  }

  const brainKey = provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  const brainKeySet = views[brainKey]?.set ?? false;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-sky-950/20 p-4 backdrop-blur-sm">
      <div className="glass-strong flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/60 px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-ink-900">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-700 hover:bg-sky-500/10"
            aria-label="Close settings"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {error && (
            <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <Section
            icon={<BrainIcon className="h-4 w-4" />}
            title="AI brain"
            ok={Boolean(status?.brain)}
          >
            <p>Paste an API key below to give JARVIS a brain. You only need one.</p>

            <div className="flex gap-1.5 rounded-full bg-white/60 p-1">
              {(["gemini", "openai"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    provider === p
                      ? "bg-sky-500 text-white shadow-sm"
                      : "text-ink-700/70 hover:bg-sky-500/10"
                  }`}
                >
                  {p === "gemini" ? "Gemini" : "OpenAI"}
                </button>
              ))}
            </div>

            <Field
              label={provider === "gemini" ? "Gemini API key" : "OpenAI API key"}
              view={views[brainKey]}
              value={draft(brainKey)}
              onChange={(v) => setDraft(brainKey, v)}
              placeholder={
                brainKeySet
                  ? views[brainKey]?.display
                  : provider === "gemini"
                    ? "AIza…"
                    : "sk-…"
              }
            />

            {provider === "gemini" && (
              <p>
                Get a free key at{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-600 underline"
                >
                  Google AI Studio
                </a>
                .
              </p>
            )}

            <SaveButton
              onClick={() =>
                save("brain", {
                  AI_PROVIDER: provider,
                  ...(draft(brainKey).trim() ? { [brainKey]: draft(brainKey) } : {}),
                })
              }
              busy={busySection === "brain"}
              saved={savedSection === "brain"}
              checks={checks.brain}
              disabled={!draft(brainKey).trim() && !brainKeySet}
            />
          </Section>

          <Section
            icon={<ChatIcon className="h-4 w-4" />}
            title="ElevenLabs voice"
            ok={Boolean(status?.elevenlabs)}
          >
            <Field
              label="ElevenLabs API key"
              view={views.ELEVENLABS_API_KEY}
              value={draft("ELEVENLABS_API_KEY")}
              onChange={(v) => setDraft("ELEVENLABS_API_KEY", v)}
              placeholder={views.ELEVENLABS_API_KEY?.display || "sk_…"}
            />
            <Field
              label="Voice ID (optional)"
              view={views.ELEVENLABS_VOICE_ID}
              value={draft("ELEVENLABS_VOICE_ID")}
              onChange={(v) => setDraft("ELEVENLABS_VOICE_ID", v)}
              placeholder="Leave blank for the default 'Adam' voice"
              hint="Find voice IDs in your ElevenLabs voice library."
            />
            <SaveButton
              onClick={() =>
                save("voice", {
                  ...(draft("ELEVENLABS_API_KEY").trim()
                    ? { ELEVENLABS_API_KEY: draft("ELEVENLABS_API_KEY") }
                    : {}),
                  ELEVENLABS_VOICE_ID: draft("ELEVENLABS_VOICE_ID"),
                })
              }
              busy={busySection === "voice"}
              saved={savedSection === "voice"}
              checks={checks.voice}
            />
          </Section>

          <Section
            icon={<MailIcon className="h-4 w-4" />}
            title="Gmail"
            ok={Boolean(status?.gmail)}
          >
            {status?.gmail ? (
              <p className="rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-sky-800">
                ✓ Connected — JARVIS can search, read, draft, reply to, and send email.
              </p>
            ) : (
              <p>
                Create an OAuth client (type: Web application) in the Google Cloud
                Console, paste its ID and secret here, then click Connect Gmail.
              </p>
            )}

            {/* redirect_uri_mismatch is the usual reason this fails, so show the
                exact string Google needs rather than describing it. */}
            <div className="rounded-lg bg-sky-500/10 px-2.5 py-2">
              <p className="mb-1 font-semibold text-ink-900">
                Add this as an Authorized redirect URI in Google:
              </p>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-white/70 px-2 py-1 font-mono text-[10px] text-ink-900">
                  {status?.gmailRedirectUri ?? "http://localhost:3000/api/gmail/callback"}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(
                        status?.gmailRedirectUri ??
                          "http://localhost:3000/api/gmail/callback"
                      )
                      .then(() => setCopiedRedirect(true))
                      .catch(() => setError("Couldn't copy — select the text instead."));
                  }}
                  className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-500/15"
                >
                  {copiedRedirect ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-ink-700/60">
                It must match character for character, including http and the port.
              </p>
            </div>

            <Field
              label="Google client ID"
              view={views.GOOGLE_CLIENT_ID}
              value={draft("GOOGLE_CLIENT_ID")}
              onChange={(v) => setDraft("GOOGLE_CLIENT_ID", v)}
              placeholder="…apps.googleusercontent.com"
            />
            <Field
              label="Google client secret"
              view={views.GOOGLE_CLIENT_SECRET}
              value={draft("GOOGLE_CLIENT_SECRET")}
              onChange={(v) => setDraft("GOOGLE_CLIENT_SECRET", v)}
              placeholder={views.GOOGLE_CLIENT_SECRET?.display || "GOCSPX-…"}
            />
            <div className="flex items-center gap-2">
              <SaveButton
                onClick={() =>
                  save("gmail", {
                    GOOGLE_CLIENT_ID: draft("GOOGLE_CLIENT_ID"),
                    ...(draft("GOOGLE_CLIENT_SECRET").trim()
                      ? { GOOGLE_CLIENT_SECRET: draft("GOOGLE_CLIENT_SECRET") }
                      : {}),
                  })
                }
                busy={busySection === "gmail"}
                saved={savedSection === "gmail"}
                checks={checks.gmail}
              />
              {status?.gmailCredentials && (
                <a
                  href="/api/gmail/auth"
                  className="rounded-full border border-sky-500/40 px-3.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/10"
                >
                  {status.gmail ? "Reconnect" : "Connect Gmail"}
                </a>
              )}
              {status?.gmail && (
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/gmail/disconnect", { method: "POST" }).catch(
                      () => null
                    );
                    onSaved();
                  }}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-700/60 hover:bg-slate-500/10"
                >
                  Disconnect
                </button>
              )}
            </div>
            {!status?.gmailCredentials && (
              <p className="text-[11px] text-ink-700/50">
                Save the client ID and secret first — the Connect button appears once
                they&apos;re stored.
              </p>
            )}
          </Section>

          <Section
            icon={<WhatsAppIcon className="h-4 w-4" />}
            title="WhatsApp"
            ok={Boolean(status?.whatsapp)}
          >
            <p>From your Twilio console — the WhatsApp sandbox works fine to start.</p>
            <Field
              label="Twilio Account SID"
              view={views.TWILIO_ACCOUNT_SID}
              value={draft("TWILIO_ACCOUNT_SID")}
              onChange={(v) => setDraft("TWILIO_ACCOUNT_SID", v)}
              placeholder="AC…"
            />
            <Field
              label="Twilio Auth Token"
              view={views.TWILIO_AUTH_TOKEN}
              value={draft("TWILIO_AUTH_TOKEN")}
              onChange={(v) => setDraft("TWILIO_AUTH_TOKEN", v)}
              placeholder={views.TWILIO_AUTH_TOKEN?.display || ""}
            />
            <Field
              label="Send from (Twilio number)"
              view={views.TWILIO_WHATSAPP_FROM}
              value={draft("TWILIO_WHATSAPP_FROM")}
              onChange={(v) => setDraft("TWILIO_WHATSAPP_FROM", v)}
              placeholder="whatsapp:+14155238886"
            />
            <Field
              label="Default recipient (optional)"
              view={views.TWILIO_WHATSAPP_TO_DEFAULT}
              value={draft("TWILIO_WHATSAPP_TO_DEFAULT")}
              onChange={(v) => setDraft("TWILIO_WHATSAPP_TO_DEFAULT", v)}
              placeholder="whatsapp:+45…"
              hint="Your own number, so you can say 'text this to me'."
            />
            <SaveButton
              onClick={() =>
                save("whatsapp", {
                  TWILIO_ACCOUNT_SID: draft("TWILIO_ACCOUNT_SID"),
                  ...(draft("TWILIO_AUTH_TOKEN").trim()
                    ? { TWILIO_AUTH_TOKEN: draft("TWILIO_AUTH_TOKEN") }
                    : {}),
                  TWILIO_WHATSAPP_FROM: draft("TWILIO_WHATSAPP_FROM"),
                  TWILIO_WHATSAPP_TO_DEFAULT: draft("TWILIO_WHATSAPP_TO_DEFAULT"),
                })
              }
              busy={busySection === "whatsapp"}
              saved={savedSection === "whatsapp"}
              checks={checks.whatsapp}
            />
          </Section>
        </div>

        <p className="border-t border-white/60 px-6 py-3 text-[11px] text-ink-700/50">
          Keys are saved to data/settings.json on this computer only — never committed to
          git and never sent to the browser once saved.
        </p>
      </div>
    </div>
  );
}
