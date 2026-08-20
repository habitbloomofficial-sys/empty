"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BrainIcon,
  ChatIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  MailIcon,
  MemoryIcon,
  MusicIcon,
  PlayIcon,
  SparkleIcon,
  WhatsAppIcon,
} from "./Icons";
import type { IntegrationStatus } from "@/lib/types";
import { describeClientFetchError, postJson } from "@/lib/clientFetch";
import { normalizeVoiceId } from "@/lib/voiceId";
import { MemoryPanel } from "./MemoryPanel";

interface VoiceOption {
  id: string;
  name: string;
  category: string | null;
}

/** Short enough not to burn credits, long enough to judge a voice by. */
const VOICE_TEST_LINE = "All operations are up and running, sir.";

interface SettingView {
  key: string;
  set: boolean;
  secret: boolean;
  display: string;
  source: "saved" | "env" | "unset";
}

interface MemoryEntry {
  id: string;
  text: string;
  updatedAt: number;
}

interface KeyCheck {
  key: string;
  ok: boolean;
  message: string;
}

type Views = Record<string, SettingView>;

type Provider = "gemini" | "openrouter" | "github" | "openai";

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  github: "GitHub",
  openai: "OpenAI",
};

const PROVIDER_KEYS: Record<Provider, string> = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
  openai: "OPENAI_API_KEY",
};

const KEY_PLACEHOLDERS: Record<Provider, string> = {
  gemini: "AIza…",
  openrouter: "sk-or-v1-…",
  github: "github_pat_… or ghp_…",
  openai: "sk-…",
};

/** Providers whose model list is fetched from the account itself. */
const LISTS_MODELS: Provider[] = ["openrouter", "github"];

async function fetchMemories(): Promise<MemoryEntry[]> {
  try {
    const res = await fetch("/api/memory", { cache: "no-store" });
    const data = await res.json();
    return Array.isArray(data.memories) ? data.memories : [];
  } catch {
    // The rest of the panel still works without them.
    return [];
  }
}

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
  extra,
}: {
  onClick: () => void;
  busy: boolean;
  saved: boolean;
  disabled?: boolean;
  checks?: KeyCheck[];
  /** Rendered beside Save — a second action that belongs to the same row. */
  extra?: React.ReactNode;
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
        {extra}
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
  const [provider, setProvider] = useState<Provider>("gemini");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busySection, setBusySection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, KeyCheck[]>>({});
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesNote, setVoicesNote] = useState<string | null>(null);
  const [byId, setById] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

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
    if (saved && saved in PROVIDER_LABELS) {
      setProvider(saved as Provider);
    } else if (next.OPENROUTER_API_KEY?.set) {
      setProvider("openrouter");
    } else if (next.GITHUB_MODELS_TOKEN?.set) {
      setProvider("github");
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

  const loadMemories = useCallback(async () => {
    setMemories(await fetchMemories());
  }, []);

  useEffect(() => {
    // Same shape as the settings fetch above: an async read guarded against a
    // panel that closes before it lands.
    let cancelled = false;
    (async () => {
      const list = await fetchMemories();
      if (!cancelled) setMemories(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!LISTS_MODELS.includes(provider)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/models", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.models)) setModels(data.models);
      } catch {
        /* the model field still accepts a typed id */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, savedSection]);

  // The voice list, refetched after a save so a newly added key fills it in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/voices", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setVoices(Array.isArray(data.voices) ? data.voices : []);
        setVoicesNote(typeof data.error === "string" ? data.error : null);
      } catch (err) {
        if (!cancelled) setVoicesNote(describeClientFetchError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedSection]);

  const draft = (key: string) => drafts[key] ?? "";
  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));

  async function save(section: string, updates: Record<string, string>) {
    setBusySection(section);
    setError(null);
    setSavedSection(null);
    setChecks((prev) => ({ ...prev, [section]: [] }));
    try {
      const data = await postJson<{ settings?: SettingView[]; checks?: KeyCheck[] }>(
        "/api/settings",
        updates
      );
      if (Array.isArray(data.settings)) applySettings(data.settings);
      const reported = data.checks;
      if (Array.isArray(reported)) {
        setChecks((prev) => ({ ...prev, [section]: reported }));
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
      setError(describeClientFetchError(err));
    } finally {
      setBusySection(null);
    }
  }

  /**
   * Speak one line in the chosen voice, before saving it. A voice id is
   * unreadable, so hearing it is the only check that means anything.
   */
  async function testVoice() {
    setTesting(true);
    setTestNote(null);
    try {
      const id = normalizeVoiceId(draft("ELEVENLABS_VOICE_ID"));
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: VOICE_TEST_LINE, ...(id ? { voiceId: id } : {}) }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `The server answered ${res.status}.`);
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
      setTestNote(null);
    } catch (err) {
      setTestNote(describeClientFetchError(err));
    } finally {
      setTesting(false);
    }
  }

  const brainKey = PROVIDER_KEYS[provider];
  const modelKey = provider === "github" ? "GITHUB_MODEL" : "OPENROUTER_MODEL";
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
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-full px-2 py-1.5 text-[11px] font-semibold transition ${
                    provider === p
                      ? "bg-sky-500 text-white shadow-sm"
                      : "text-ink-700/70 hover:bg-sky-500/10"
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>

            <Field
              label={provider === "github" ? "GitHub token" : `${PROVIDER_LABELS[provider]} API key`}
              view={views[brainKey]}
              value={draft(brainKey)}
              onChange={(v) => setDraft(brainKey, v)}
              placeholder={brainKeySet ? views[brainKey]?.display : KEY_PLACEHOLDERS[provider]}
            />

            {LISTS_MODELS.includes(provider) && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-900">Model</span>
                <input
                  list="account-models"
                  value={draft(modelKey)}
                  onChange={(e) => setDraft(modelKey, e.target.value)}
                  placeholder={
                    provider === "github"
                      ? "openai/gpt-4o — start typing to search"
                      : "anthropic/claude-… — start typing to search"
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/80 bg-white/70 px-3 py-2 font-mono text-xs text-ink-900 placeholder:font-sans placeholder:text-ink-700/35 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
                />
                <span className="mt-1 block text-[10px] text-ink-700/50">
                  {models.length > 0
                    ? `${models.length} models your ${
                        provider === "github" ? "token" : "key"
                      } can reach. Ids are namespaced, like openai/gpt-4o.`
                    : "Save your key and reopen this panel to load the list of models."}
                </span>
                {/* Populated from your own account, so it is never out of date. */}
                <datalist id="account-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
              </label>
            )}

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

            {provider === "github" && (
              <p>
                Free frontier models on your GitHub account. Create a token at{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-600 underline"
                >
                  github.com/settings
                </a>{" "}
                — a fine-grained token needs the <b>Models</b> permission set to
                read-only, and a classic token works as it is. The free tier caps
                requests per minute and per day.
              </p>
            )}

            {provider === "openrouter" && (
              <p>
                One key for most of the frontier models — get one at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-600 underline"
                >
                  openrouter.ai/keys
                </a>
                . Only models that can call tools are listed, since JARVIS needs
                them to open apps and read email.
              </p>
            )}

            <SaveButton
              onClick={() =>
                save("brain", {
                  AI_PROVIDER: provider,
                  ...(draft(brainKey).trim() ? { [brainKey]: draft(brainKey) } : {}),
                  ...(LISTS_MODELS.includes(provider) ? { [modelKey]: draft(modelKey) } : {}),
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
            {/* A voice id is 20 unreadable characters, so picking from the
                account's own voices beats typing one and hoping. The id box is
                still there for a voice the list doesn't know about. */}
            {voices.length > 0 && !byId ? (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-900">
                  Voice
                </span>
                <select
                  value={
                    voices.some((v) => v.id === normalizeVoiceId(draft("ELEVENLABS_VOICE_ID")))
                      ? normalizeVoiceId(draft("ELEVENLABS_VOICE_ID"))
                      : ""
                  }
                  onChange={(e) => {
                    if (e.target.value === "__other__") {
                      setById(true);
                      return;
                    }
                    setDraft("ELEVENLABS_VOICE_ID", e.target.value);
                  }}
                  className="w-full rounded-lg border border-white/80 bg-white/70 px-3 py-2 text-xs text-ink-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
                >
                  <option value="">Default voice (Adam)</option>
                  {voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                      {voice.category ? ` — ${voice.category}` : ""}
                    </option>
                  ))}
                  <option value="__other__">Paste a voice ID instead…</option>
                </select>
                <span className="mt-1 block text-[10px] text-ink-700/50">
                  These are the voices in your ElevenLabs account. To use one from
                  the Voice Library, open it there and click “Add to my voices” —
                  it appears here straight after.
                </span>
              </label>
            ) : (
              <Field
                label="Voice ID"
                view={views.ELEVENLABS_VOICE_ID}
                value={draft("ELEVENLABS_VOICE_ID")}
                onChange={(v) => setDraft("ELEVENLABS_VOICE_ID", v)}
                placeholder="Leave blank for the default 'Adam' voice"
                hint={
                  voicesNote ??
                  "Paste the ID from ElevenLabs → Voices → My Voices. A share link works too."
                }
              />
            )}

            {voices.length > 0 && byId && (
              <button
                type="button"
                onClick={() => setById(false)}
                className="text-[11px] font-medium text-sky-600 hover:underline"
              >
                ← Back to my voices
              </button>
            )}

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
              extra={
                <button
                  type="button"
                  onClick={testVoice}
                  disabled={testing || !status?.elevenlabs}
                  className="rounded-full border border-sky-500/40 px-3.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-500/10 disabled:opacity-40"
                >
                  {testing ? "Speaking…" : "Hear it"}
                </button>
              }
            />
            {testNote && (
              <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700">
                ⚠ {testNote}
              </p>
            )}
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

          <Section
            icon={<MusicIcon className="h-4 w-4" />}
            title="Apps & websites"
            ok={Boolean(status?.desktopControl)}
          >
            <p>
              Lets JARVIS open things on this computer — &quot;open Spotify&quot;,
              &quot;put on some Bowie&quot;, &quot;open YouTube&quot;, &quot;search
              YouTube for lo-fi&quot;, or any site you name. Spotify opens to a search;
              pressing play is still yours.
            </p>
            <div className="flex gap-1.5 rounded-full bg-white/60 p-1">
              {(["on", "off"] as const).map((value) => {
                const active = (status?.desktopControl ? "on" : "off") === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => save("desktop", { DESKTOP_CONTROL: value })}
                    disabled={busySection === "desktop"}
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                      active
                        ? "bg-sky-500 text-white shadow-sm"
                        : "text-ink-700/70 hover:bg-sky-500/10"
                    }`}
                  >
                    {value === "on" ? "Allowed" : "Blocked"}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-ink-700/50">
              This permits opening Spotify, ordinary web pages, and files found by
              the search below — nothing else. No other protocols, and no general
              &quot;run a command&quot; ability behind it.
            </p>
          </Section>

          <Section
            icon={<PlayIcon className="h-4 w-4" />}
            title="YouTube"
            ok={Boolean(status?.youtube)}
          >
            <p>
              Lets JARVIS report on your channel — subscribers, total views, and how
              your recent uploads are doing. Ask him &quot;how&apos;s the channel
              doing?&quot; once this is set.
            </p>
            <Field
              label="YouTube Data API key"
              view={views.YOUTUBE_API_KEY}
              value={draft("YOUTUBE_API_KEY")}
              onChange={(v) => setDraft("YOUTUBE_API_KEY", v)}
              placeholder="AIza…"
              hint={
                <>
                  Free from{" "}
                  <a
                    href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 underline"
                  >
                    Google Cloud
                  </a>
                  : enable “YouTube Data API v3”, then create an API key. Leave this
                  blank to try your Gemini key — it works if YouTube is enabled on the
                  same project.
                </>
              }
            />
            <Field
              label="Your channel"
              view={views.YOUTUBE_CHANNEL}
              value={draft("YOUTUBE_CHANNEL")}
              onChange={(v) => setDraft("YOUTUBE_CHANNEL", v)}
              placeholder="@yourhandle"
              hint="Your @handle, channel URL, or channel ID — whichever you have to hand."
            />
            <SaveButton
              onClick={() =>
                save("youtube", {
                  ...(draft("YOUTUBE_API_KEY").trim()
                    ? { YOUTUBE_API_KEY: draft("YOUTUBE_API_KEY") }
                    : {}),
                  YOUTUBE_CHANNEL: draft("YOUTUBE_CHANNEL"),
                })
              }
              busy={busySection === "youtube"}
              saved={savedSection === "youtube"}
              checks={checks.youtube}
            />
            <p className="text-[10px] text-ink-700/50">
              These are the public numbers, the same ones on your channel page.
              YouTube rounds subscriber counts above a thousand, and watch time and
              impressions live in Studio behind a separate login.
            </p>
          </Section>

          <Section
            icon={<FolderIcon className="h-4 w-4" />}
            title="Files"
            ok={(status?.fileRoots?.length ?? 0) > 0}
          >
            <p>
              JARVIS can find files in your own folders — ask him &quot;where&apos;s
              my tax return?&quot; or &quot;find the video I downloaded
              yesterday&quot; — and open what he finds. He can see where files are,
              not what is inside them.
            </p>
            {status?.fileRoots && status.fileRoots.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {status.fileRoots.map((root) => (
                  <span
                    key={root}
                    className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700"
                  >
                    {root}
                  </span>
                ))}
              </div>
            )}
            <Field
              label="Extra folders (optional)"
              view={views.FILE_SEARCH_ROOTS}
              value={draft("FILE_SEARCH_ROOTS")}
              onChange={(v) => setDraft("FILE_SEARCH_ROOTS", v)}
              placeholder="D:\\Projects; E:\\Archive"
              hint="Full paths, separated by semicolons. Everything outside these folders and the ones above is invisible to him."
            />
            <SaveButton
              onClick={() => save("files", { FILE_SEARCH_ROOTS: draft("FILE_SEARCH_ROOTS") })}
              busy={busySection === "files"}
              saved={savedSection === "files"}
            />
            <p className="text-[10px] text-ink-700/50">
              Searching follows the Apps &amp; websites switch above — turn that off
              and file search goes with it.
            </p>
          </Section>
          <Section
            icon={<MemoryIcon className="h-4 w-4" />}
            title="Memory"
            ok={memories.length > 0}
          >
            <p>
              Things JARVIS has learned about you, kept between sessions. He saves
              these himself as they come up — names, preferences, how you like things
              done — and you can ask him to forget any of them.
            </p>

            {memories.length === 0 ? (
              <p className="text-[11px] text-ink-700/50">
                Nothing yet. He&apos;ll start remembering as you talk.
              </p>
            ) : (
              <ul className="max-h-44 space-y-1 overflow-y-auto">
                {memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="group flex items-start gap-2 rounded-lg bg-white/50 px-2.5 py-1.5"
                  >
                    <span className="flex-1 text-[11px] leading-relaxed text-ink-900">
                      {memory.text}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/memory?id=${encodeURIComponent(memory.id)}`, {
                          method: "DELETE",
                        }).catch(() => null);
                        await loadMemories();
                        onSaved();
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-700/40 hover:bg-rose-500/10 hover:text-rose-600"
                      aria-label="Forget this"
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {memories.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/memory", { method: "DELETE" }).catch(() => null);
                  await loadMemories();
                  onSaved();
                }}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-700/60 hover:bg-slate-500/10"
              >
                Forget everything
              </button>
            )}
          </Section>

          <Section
            icon={<SparkleIcon className="h-4 w-4" />}
            title="Personality"
            ok
          >
            <p>
              How JARVIS speaks to you. Both apply everywhere — spoken replies,
              typed ones, and the little things he says while he works.
            </p>
            <Field
              label="He calls you"
              view={views.USER_TITLE}
              value={draft("USER_TITLE")}
              onChange={(v) => setDraft("USER_TITLE", v)}
              placeholder="sir"
              hint="Anything you like — sir, boss, captain, your name. Leave blank for “sir”."
            />
            <div>
              <span className="mb-1 block text-[11px] font-semibold text-ink-900">Humour</span>
              <div className="flex gap-1.5 rounded-full bg-white/60 p-1">
                {(
                  [
                    ["dry", "Dry"],
                    ["playful", "Playful"],
                    ["off", "Straight"],
                  ] as const
                ).map(([value, label]) => {
                  const active = (draft("HUMOUR") || status?.humour || "dry") === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraft("HUMOUR", value)}
                      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-sky-500 text-white shadow-sm"
                          : "text-ink-700/70 hover:bg-sky-500/10"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 block text-[10px] text-ink-700/50">
                Playful teases you, gets smug when it pulls something off, and acts
                mildly put upon before doing exactly as asked. It drops the act when
                something actually matters.
              </span>
            </div>
            <SaveButton
              onClick={() =>
                save("personality", {
                  USER_TITLE: draft("USER_TITLE"),
                  HUMOUR: draft("HUMOUR") || "dry",
                })
              }
              busy={busySection === "personality"}
              saved={savedSection === "personality"}
            />
            <p className="text-[10px] text-ink-700/50">
              Some things are fixed: say “Hey JARVIS, daddy&apos;s home” and the
              answer is always, exactly, “Welcome home,{" "}
              {draft("USER_TITLE") || status?.title || "sir"}.”
            </p>
          </Section>

          <Section
            icon={<ClockIcon className="h-4 w-4" />}
            title="Sessions & notes"
            ok={(status?.sessionDays ?? 0) > 0}
          >
            <MemoryPanel onChanged={onSaved} />
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
