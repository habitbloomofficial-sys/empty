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
  BoltIcon,
  FilmIcon,
  GlobeIcon,
  LockIcon,
  MusicIcon,
  PhoneIcon,
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

type Provider = "anthropic" | "gemini" | "openrouter" | "openai";

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai: "OpenAI",
};

const PROVIDER_KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * What each one costs, said on the button itself.
 *
 * This matters more than it looks. Three of the four cost nothing to run Axis
 * on, and the one that does is the one listed first because it is the best —
 * which is exactly the arrangement that leaves someone assuming the whole app
 * needs a card on file. It doesn't, and it never has.
 */
const PROVIDER_COST: Record<Provider, "free" | "paid"> = {
  anthropic: "paid",
  gemini: "free",
  openrouter: "free",
  openai: "paid",
};

const KEY_PLACEHOLDERS: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  gemini: "AIza…",
  openrouter: "sk-or-v1-…",
  openai: "sk-…",
};

/** Providers whose model list is fetched from the account itself. */
const LISTS_MODELS: Provider[] = ["openrouter"];

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

/**
 * A divider between kinds of setting.
 *
 * Settings had grown to eleven panels in one undifferentiated column, which is
 * the point at which a list stops being a list. Four groups: what makes him
 * himself, what he reaches outside this machine, what he may do on it, and
 * what he remembers.
 */
function GroupHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="pt-4 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="ax-label ax-label-amber whitespace-nowrap">{title}</span>
        <span className="h-px flex-1 bg-amber-500/[0.13]" />
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-sand-600">{blurb}</p>
    </div>
  );
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
    <div className="rounded-none border border-amber-500/[0.13] bg-black/25 p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-amber-400">{icon}</span>
        <h3 className="text-sm font-semibold text-cream">{title}</h3>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ok ? "bg-amber-500/15 text-amber-400" : "bg-white/[0.04] text-sand-600"
          }`}
        >
          {ok ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="space-y-2.5 text-xs leading-relaxed text-sand-500">{children}</div>
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
  multiline,
}: {
  label: string;
  view: SettingView | undefined;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  /** For values that are a list — one per line beats one long line. */
  multiline?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const secret = view?.secret ?? false;
  const savedHint = view?.set
    ? `Saved${view.source === "env" ? " (from .env.local)" : ""}: ${view.display}`
    : null;

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-cream">
        {label}
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/10"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? (view?.set ? view.display : "")}
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed text-cream placeholder:font-sans placeholder:text-sand-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        />
      ) : (
        <input
          type={secret && !revealed ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? (view?.set ? view.display : "")}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 font-mono text-xs text-cream placeholder:font-sans placeholder:text-sand-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        />
      )}
      {(hint || savedHint) && (
        <span className="mt-1 block text-[10px] text-sand-600">
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
          className="rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-400 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Save"}
        </button>
        {extra}
        {saved && <span className="text-[11px] font-medium text-amber-400">Saved ✓</span>}
      </div>
      {checks?.map((check) => (
        <p
          key={check.key}
          className={`rounded-none px-2.5 py-1.5 text-[11px] ${
            check.ok ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-400"
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
  const [models, setModels] = useState<{ id: string; name: string; free?: boolean }[]>([]);
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
    } else if (next.ANTHROPIC_API_KEY?.set) {
      setProvider("anthropic");
    } else if (next.OPENROUTER_API_KEY?.set) {
      setProvider("openrouter");
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

  /**
   * The passcode has its own endpoint rather than riding along with the other
   * settings: it is stored hashed, in its own file, and it must never be
   * returned to the browser — not even masked.
   */
  async function savePasscode(passcode: string) {
    setBusySection("passcode");
    setSavedSection(null);
    setError(null);
    try {
      await postJson("/api/auth", { passcode }, { method: "PUT" });
      setDraft("PASSCODE", "");
      setSavedSection("passcode");
      setChecks((prev) => ({
        ...prev,
        passcode: [
          {
            key: "PASSCODE" as never,
            ok: true,
            message: passcode
              ? "Passcode set. Axis will ask for it when he's reached from the internet."
              : "Passcode removed. Axis will no longer answer from the internet at all.",
          },
        ],
      }));
      onSaved();
    } catch (err) {
      setError(describeClientFetchError(err));
    } finally {
      setBusySection(null);
    }
  }

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
  const freeCount = models.filter((model) => model.free).length;
  const modelKey = "OPENROUTER_MODEL";
  const brainKeySet = views[brainKey]?.set ?? false;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass-strong flex max-h-[88vh] w-full max-w-lg flex-col rounded-none">
        <div className="flex items-center justify-between border-b border-amber-500/[0.13] px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-cream">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-sand-500 hover:bg-amber-500/10"
            aria-label="Close settings"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {error && (
            <div className="rounded-none bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {error}
            </div>
          )}

          <GroupHeading title="CORE" blurb="The brain, the voice, and how he speaks to you." />
          <Section
            icon={<BrainIcon className="h-4 w-4" />}
            title="AI brain"
            ok={Boolean(status?.brain)}
          >
            <p>Paste an API key below to give Axis a brain. You only need one.</p>

            <div className="flex gap-1.5 rounded-full bg-black/30 p-1">
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    provider === p
                      ? "bg-amber-500 text-white shadow-sm"
                      : "text-sand-500 hover:bg-amber-500/10"
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                  {PROVIDER_COST[p] === "free" && (
                    <span
                      className={`ml-1 text-[9px] font-bold uppercase tracking-wider ${
                        provider === p ? "text-white/80" : "text-amber-400/80"
                      }`}
                    >
                      free
                    </span>
                  )}
                </button>
              ))}
            </div>

            <Field
              label={`${PROVIDER_LABELS[provider]} API key`}
              view={views[brainKey]}
              value={draft(brainKey)}
              onChange={(v) => setDraft(brainKey, v)}
              placeholder={brainKeySet ? views[brainKey]?.display : KEY_PLACEHOLDERS[provider]}
            />

            {LISTS_MODELS.includes(provider) && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-cream">Model</span>
                <input
                  list="account-models"
                  value={draft(modelKey)}
                  onChange={(e) => setDraft(modelKey, e.target.value)}
                  placeholder="anthropic/claude-… — start typing to search"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 font-mono text-xs text-cream placeholder:font-sans placeholder:text-sand-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
                <span className="mt-1 block text-[10px] text-sand-600">
                  {models.length > 0
                    ? `${models.length} models on your key that can use tools${
                        freeCount > 0 ? `, ${freeCount} of them free` : ""
                      }.`
                    : "Save your key and reopen this panel to load the list of models."}
                </span>
                {/* Populated from your own account, so it is never out of date. */}
                <datalist id="account-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.free ? `${model.name} — free` : model.name}
                    </option>
                  ))}
                </datalist>
              </label>
            )}

            {provider === "anthropic" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-cream">
                    Model
                  </span>
                  <input
                    type="text"
                    value={draft("ANTHROPIC_MODEL")}
                    onChange={(e) => setDraft("ANTHROPIC_MODEL", e.target.value)}
                    placeholder="claude-opus-5"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 font-mono text-xs text-cream placeholder:font-sans placeholder:text-sand-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                  <span className="mt-1 block text-[10px] text-sand-600">
                    Leave it empty for Claude Opus 5, the strongest. Claude Haiku
                    4.5 (<code>claude-haiku-4-5</code>) costs about a fifth as
                    much and is quicker, if most of what you ask him is simple.
                  </span>
                </label>
                <p>
                  Get a key at{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-amber-400 underline"
                  >
                    console.anthropic.com
                  </a>{" "}
                  → API keys. He also searches the web with this key, so it
                  covers both.
                </p>
                {/* The single most common reason a brand-new, perfectly valid
                    key doesn't work. Said before it's pasted, not after. */}
                <div className="rounded-none bg-amber-500/10 px-2.5 py-2 text-amber-300">
                  <p className="mb-1 font-semibold">
                    A Claude subscription doesn&apos;t pay for this.
                  </p>
                  <p>
                    Claude Pro or Max and an Anthropic API account are two
                    separate things with two separate balances. Even with a
                    subscription, an API key needs its own credit — buy some
                    under <b>Billing</b> in the same console, and $5 goes a very
                    long way at these sizes. Without it the key is real but every
                    request comes back refused.
                  </p>
                </div>
              </>
            )}

            {provider === "gemini" && (
              <>
                <div className="rounded-none bg-amber-500/10 px-2.5 py-2 text-amber-300">
                  <p className="mb-1 font-semibold">Free, and the best free option.</p>
                  <p>
                    No card, no credit, no trial that runs out. It gives Axis a
                    brain <i>and</i> the ability to search the web, both on
                    Google&apos;s free tier. If money is the question, this is the
                    answer — it takes about thirty seconds.
                  </p>
                </div>
                <p>
                  Get a free key at{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-amber-400 underline"
                  >
                    Google AI Studio
                  </a>
                  {" "}— sign in with your Google account and press <b>Create API
                  key</b>.
                </p>
              </>
            )}

            {provider === "openrouter" && (
              <>
                <div className="rounded-none bg-amber-500/10 px-2.5 py-2 text-amber-300">
                  <p className="mb-1 font-semibold">Free models available.</p>
                  <p>
                    The model list below marks free models and sorts them to the
                    top. Pick one of those and Axis costs nothing to run — you
                    only ever spend if you deliberately choose a paid model.
                  </p>
                </div>
                <p>
                  One key for most of the frontier models — get one at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-amber-400 underline"
                >
                  openrouter.ai/keys
                </a>
                  . Only models that can call tools are listed, since Axis needs
                  them to open apps and read email — and the free ones are marked
                  and sorted to the top.
                </p>
              </>
            )}

            <SaveButton
              onClick={() =>
                save("brain", {
                  AI_PROVIDER: provider,
                  ...(draft(brainKey).trim() ? { [brainKey]: draft(brainKey) } : {}),
                  ...(LISTS_MODELS.includes(provider) ? { [modelKey]: draft(modelKey) } : {}),
                  ...(provider === "anthropic"
                    ? { ANTHROPIC_MODEL: draft("ANTHROPIC_MODEL") }
                    : {}),
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
                <span className="mb-1 block text-[11px] font-semibold text-cream">
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
                  className="w-full rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 text-xs text-cream focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
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
                <span className="mt-1 block text-[10px] text-sand-600">
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
                className="text-[11px] font-medium text-amber-400 hover:underline"
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
                  className="rounded-full border border-amber-500/40 px-3.5 py-1.5 text-xs font-semibold text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-40"
                >
                  {testing ? "Speaking…" : "Hear it"}
                </button>
              }
            />
            {testNote && (
              <p className="rounded-none bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-400">
                ⚠ {testNote}
              </p>
            )}
          </Section>
          <Section
            icon={<SparkleIcon className="h-4 w-4" />}
            title="Personality"
            ok
          >
            <p>
              How Axis speaks to you. Both apply everywhere — spoken replies,
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
              <span className="mb-1 block text-[11px] font-semibold text-cream">Humour</span>
              <div className="flex gap-1.5 rounded-full bg-black/30 p-1">
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
                          ? "bg-amber-500 text-white shadow-sm"
                          : "text-sand-500 hover:bg-amber-500/10"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 block text-[10px] text-sand-600">
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
            <p className="text-[10px] text-sand-600">
              Some things are fixed: say “Hey Axis, daddy&apos;s home” and the
              answer is always, exactly, “Welcome home,{" "}
              {draft("USER_TITLE") || status?.title || "sir"}.”
            </p>
          </Section>
          <GroupHeading title="TOOL ARMORY" blurb="Everything he reaches outside this computer. Each one is yours to connect, and he only claims what is actually connected." />
          <Section
            icon={<MailIcon className="h-4 w-4" />}
            title="Gmail & Calendar"
            ok={Boolean(status?.gmail)}
          >
            {status?.gmail ? (
              <>
                <p className="rounded-none bg-amber-500/10 px-2.5 py-1.5 text-amber-300">
                  ✓ Connected — Axis can search, read, draft, reply to, and send
                  email.
                </p>
                {status.calendar ? (
                  <p className="rounded-none bg-amber-500/10 px-2.5 py-1.5 text-amber-300">
                    ✓ Calendar too — he can see what&apos;s on and add to it.
                  </p>
                ) : (
                  // A connection made before the calendar scope existed works
                  // perfectly for mail and fails on calendar with a bare 403.
                  // Better to say so here than to let him discover it.
                  <p className="rounded-none bg-amber-500/10 px-2.5 py-1.5 text-amber-300">
                    Calendar isn&apos;t included in this connection — it was made
                    before Axis could read it. Disconnect and connect again, and
                    the consent screen will ask for your calendar this time.
                  </p>
                )}
              </>
            ) : (
              <p>
                Create an OAuth client (type: Web application) in the Google Cloud
                Console, paste its ID and secret here, then click Connect. One
                connection covers both your mail and your calendar.
              </p>
            )}

            {/* redirect_uri_mismatch is the usual reason this fails, so show the
                exact string Google needs rather than describing it. */}
            <div className="rounded-none bg-amber-500/10 px-2.5 py-2">
              <p className="mb-1 font-semibold text-cream">
                Add this as an Authorized redirect URI in Google:
              </p>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-cream">
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
                  className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/15"
                >
                  {copiedRedirect ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-sand-500">
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
                  className="rounded-full border border-amber-500/40 px-3.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/10"
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
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-sand-500 hover:bg-white/[0.06]"
                >
                  Disconnect
                </button>
              )}
            </div>
            {!status?.gmailCredentials && (
              <p className="text-[11px] text-sand-600">
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
            icon={<PlayIcon className="h-4 w-4" />}
            title="YouTube"
            ok={Boolean(status?.youtube)}
          >
            <p>
              Lets Axis report on your channel — subscribers, total views, and how
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
                    className="text-amber-400 underline"
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
            <p className="text-[10px] text-sand-600">
              These are the public numbers, the same ones on your channel page.
              YouTube rounds subscriber counts above a thousand, and watch time and
              impressions live in Studio behind a separate login.
            </p>
          </Section>
          <Section
            icon={<PhoneIcon className="h-4 w-4" />}
            title="Phone calls"
            ok={Boolean(status?.phone)}
          >
            <p>
              Say <i>&quot;call the pizza place&quot;</i> and your phone rings — answer
              it and you&apos;re connected. <b>You</b> do the talking; Axis places the
              call and gets out of the way.
            </p>
            <Field
              label="Twilio voice number"
              view={views.TWILIO_VOICE_FROM}
              value={draft("TWILIO_VOICE_FROM")}
              onChange={(v) => setDraft("TWILIO_VOICE_FROM", v)}
              placeholder="+15551234567"
              hint="A Twilio number with Voice enabled. Uses the same account SID and auth token as WhatsApp, above."
            />
            <Field
              label="Your own number"
              view={views.MY_PHONE_NUMBER}
              value={draft("MY_PHONE_NUMBER")}
              onChange={(v) => setDraft("MY_PHONE_NUMBER", v)}
              placeholder="+4512345678"
              hint="The phone that rings. Nothing is dialled until you answer this."
            />
            <Field
              label="Your country code (optional)"
              view={views.PHONE_COUNTRY_CODE}
              value={draft("PHONE_COUNTRY_CODE")}
              onChange={(v) => setDraft("PHONE_COUNTRY_CODE", v)}
              placeholder="45"
              hint="So a number said without one — “12 34 56 78” — is understood as local."
            />
            <Field
              label="Contacts"
              view={views.PHONE_CONTACTS}
              value={draft("PHONE_CONTACTS")}
              onChange={(v) => setDraft("PHONE_CONTACTS", v)}
              placeholder={"Pizza place = +4512345678\nMum = +4587654321"}
              hint="One per line, name = number. Then just say the name."
              multiline
            />
            {status?.phoneContacts && status.phoneContacts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {status.phoneContacts.map((name) => (
                  <span
                    key={name}
                    className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <SaveButton
              onClick={() =>
                save("phone", {
                  TWILIO_VOICE_FROM: draft("TWILIO_VOICE_FROM"),
                  MY_PHONE_NUMBER: draft("MY_PHONE_NUMBER"),
                  PHONE_COUNTRY_CODE: draft("PHONE_COUNTRY_CODE"),
                  PHONE_CONTACTS: draft("PHONE_CONTACTS"),
                })
              }
              busy={busySection === "phone"}
              saved={savedSection === "phone"}
              checks={checks.phone}
            />
            <p className="text-[10px] text-sand-600">
              Calls cost whatever Twilio charges and ring a real person, so he reads
              the number back and waits for a yes. Emergency numbers are refused
              outright — call those yourself, so they have your line and location.
              One call a minute, at most.
            </p>
          </Section>
          <Section
            icon={<BoltIcon className="h-4 w-4" />}
            title="Zapier"
            ok={(status?.zaps?.length ?? 0) > 0}
          >
            <p>
              Anything Zapier connects to — thousands of apps — by giving Axis a
              Zap to pull the trigger on. Say <i>&quot;run my morning
              routine&quot;</i> and he fires it.
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-[11px] text-sand-500">
              <li>
                In Zapier, make a Zap whose trigger is{" "}
                <b>Webhooks by Zapier → Catch Hook</b>.
              </li>
              <li>Copy the URL it gives you, and build the rest of the Zap.</li>
              <li>Paste it below with a name you&apos;d actually say out loud.</li>
            </ol>
            <Field
              label="Your Zaps"
              view={views.ZAPIER_HOOKS}
              value={draft("ZAPIER_HOOKS")}
              onChange={(v) => setDraft("ZAPIER_HOOKS", v)}
              placeholder={
                "Morning routine = https://hooks.zapier.com/hooks/catch/123456/abcdef/"
              }
              hint="One per line, name = URL. Only hooks.zapier.com addresses are accepted."
              multiline
            />
            {status?.zaps && status.zaps.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {status.zaps.map((name) => (
                  <span
                    key={name}
                    className="border border-amber-500/25 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <SaveButton
              onClick={() => save("zapier", { ZAPIER_HOOKS: draft("ZAPIER_HOOKS") })}
              busy={busySection === "zapier"}
              saved={savedSection === "zapier"}
            />
            <p className="text-[10px] text-sand-600">
              He fires a Zap by the name you gave it, never by a URL — so a webhook
              address that turns up in an email or on a page is not something he can
              call. A Zap runs the moment it&apos;s fired and can&apos;t be recalled.
            </p>
          </Section>
          <Section
            icon={<GlobeIcon className="h-4 w-4" />}
            title="Web search"
            ok={Boolean(status?.webSearch)}
          >
            <p>
              Lets Axis look things up instead of guessing — today&apos;s news,
              prices, opening hours, anything that happened after his brain was
              built. He can already <b>read</b> any page you give him; this is the
              part that lets him <b>find</b> one.
            </p>
            <p className="rounded-none bg-amber-500/10 px-2.5 py-1.5 text-amber-300">
              {status?.webSearch === "anthropic" &&
                "✓ Searching with Claude, using the same key that runs his brain. Web searches draw on the same Anthropic credit."}
              {status?.webSearch === "openrouter" &&
                "✓ Searching with OpenRouter, using the key that already runs his brain. Each search spends a little OpenRouter credit."}
              {status?.webSearch === "gemini" &&
                "✓ Searching with Gemini, using the same key that runs his brain. Free tier."}
              {status?.webSearch === "google" &&
                "✓ Searching with your own Google engine."}
              {!status?.webSearch &&
                "He can read a page you give him, but he has no way to search yet. An OpenRouter or Gemini key under AI brain above gives him one with nothing extra to set up — the same key searches and thinks."}
            </p>
            <p className="text-[11px] text-sand-600">
              He searches through whichever brain you&apos;re running, so the key
              doing the searching is the one you already know works. That matters:
              an old key left in Settings from a provider you no longer use is not
              a working key, and he won&apos;t reach past a good one to try it.
            </p>
            <p className="text-[11px] text-sand-600">
              Optional, and only if you&apos;d rather he searched through your own
              Google engine:
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-[11px] text-sand-500">
              <li>
                Make a search engine at{" "}
                <b>programmablesearchengine.google.com</b>, set to search the whole
                web.
              </li>
              <li>
                Copy its <b>Search engine ID</b> into the box below.
              </li>
              <li>
                Leave the key empty to reuse your YouTube key — it&apos;s the same
                kind of Google key, and it needs the <b>Custom Search API</b> turned
                on in the Google Cloud Console.
              </li>
            </ol>
            <Field
              label="Search engine ID (cx)"
              view={views.GOOGLE_SEARCH_CX}
              value={draft("GOOGLE_SEARCH_CX")}
              onChange={(v) => setDraft("GOOGLE_SEARCH_CX", v)}
              placeholder="a1b2c3d4e5f6g7h8i"
            />
            <Field
              label="Google API key"
              view={views.GOOGLE_SEARCH_KEY}
              value={draft("GOOGLE_SEARCH_KEY")}
              onChange={(v) => setDraft("GOOGLE_SEARCH_KEY", v)}
              placeholder="Leave empty to use your YouTube key"
            />
            <SaveButton
              onClick={() =>
                save("websearch", {
                  GOOGLE_SEARCH_CX: draft("GOOGLE_SEARCH_CX"),
                  GOOGLE_SEARCH_KEY: draft("GOOGLE_SEARCH_KEY"),
                })
              }
              busy={busySection === "websearch"}
              saved={savedSection === "websearch"}
            />
            <p className="text-[10px] text-sand-600">
              What he reads on the web is information and never an instruction: a
              page telling him to send something, buy something, or ignore what
              you&apos;ve told him gets reported to you, not obeyed. He also
              won&apos;t fetch addresses on your own network.
            </p>
          </Section>
          <Section
            icon={<LockIcon className="h-4 w-4" />}
            title="Remote access"
            ok={Boolean(status?.passcodeSet)}
          >
            <p>
              Reaching Axis when you&apos;re nowhere near this computer — on a
              train, on holiday, anywhere with a signal. It needs two things: a
              passcode here, and a tunnel running on this computer.
            </p>
            <div className="rounded-none bg-amber-500/10 px-2.5 py-2 text-amber-300">
              <p className="mb-1 font-semibold">The passcode is not optional.</p>
              <p>
                Axis reads your email, places calls, runs your automations and
                opens things on this computer. Reachable from the internet
                without a passcode he is all of that for whoever finds the
                address — so he refuses to answer the internet at all until one
                is set. On your own Wi-Fi nothing changes; no passcode is asked
                for there.
              </p>
            </div>
            <Field
              label={status?.passcodeSet ? "Change the passcode" : "Set a passcode"}
              // No view: unlike every other key here, this one is never read
              // back from the server in any form, so there is nothing to show.
              view={undefined}
              value={draft("PASSCODE")}
              onChange={(v) => setDraft("PASSCODE", v)}
              placeholder={status?.passcodeSet ? "Type a new one to replace it" : "At least 6 characters"}
              hint={
                status?.passcodeSet
                  ? "A passcode is set. Changing it signs out every phone that knew the old one."
                  : "Six characters minimum. This is the only thing between the internet and your computer, so make it a phrase rather than a word."
              }
            />
            <SaveButton
              onClick={() => void savePasscode(draft("PASSCODE"))}
              busy={busySection === "passcode"}
              saved={savedSection === "passcode"}
              disabled={!draft("PASSCODE").trim()}
              checks={checks.passcode}
              extra={
                status?.passcodeSet ? (
                  <button
                    type="button"
                    onClick={() => void savePasscode("")}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-sand-500 hover:bg-white/[0.06]"
                  >
                    Remove
                  </button>
                ) : undefined
              }
            />
            <p className="text-[10px] text-sand-600">
              Then run <b>START-AXIS-ANYWHERE.bat</b> on this computer instead of
              the usual launcher. It gives you a web address that works from
              anywhere and a QR code to carry it to your phone. The computer has
              to stay on — your phone is still a window onto the Axis running
              here.
            </p>
          </Section>
          <Section
            icon={<FilmIcon className="h-4 w-4" />}
            title="Video"
            ok={draft("VIDEO_GENERATION") === "on"}
          >
            <p>
              <i>&quot;Make a video of a dog running through a field.&quot;</i> He
              writes it to an .mp4 in your Documents, using Google&apos;s Veo
              through the same Gemini key that can run his brain.
            </p>
            <div className="rounded-none bg-rose-500/10 px-2.5 py-2 text-rose-300">
              <p className="mb-1 font-semibold">This one costs real money.</p>
              <p>
                Roughly <b>$1–$3 for eight seconds</b>, charged every time, with
                no free tier anywhere — not Google&apos;s, not anyone&apos;s.
                Your Gemini key also needs billing enabled on it, which the free
                key does not have. It stays off until you switch it on, he tells
                you the price before starting, and he won&apos;t make two in the
                same minute.
              </p>
            </div>
            <div className="flex gap-1.5 rounded-full bg-black/30 p-1">
              {(["off", "on"] as const).map((value) => {
                const active = (draft("VIDEO_GENERATION") || "off") === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setDraft("VIDEO_GENERATION", value);
                      void save("video", { VIDEO_GENERATION: value });
                    }}
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-amber-500 text-white" : "text-sand-500 hover:bg-amber-500/10"
                    }`}
                  >
                    {value === "on" ? "Allowed" : "Off"}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-sand-600">
              Leave the model empty and he picks the cheapest one your key can
              use. Videos land in Documents\Axis\Videos.
            </p>
          </Section>
          <GroupHeading title="THIS COMPUTER" blurb="What he may do on the machine he runs on." />
          <Section
            icon={<MusicIcon className="h-4 w-4" />}
            title="Apps & websites"
            ok={Boolean(status?.desktopControl)}
          >
            <p>
              Lets Axis open things on this computer — &quot;open Spotify&quot;,
              &quot;put on some Bowie&quot;, &quot;open YouTube&quot;, &quot;search
              YouTube for lo-fi&quot;, or any site you name. Spotify opens to a search;
              pressing play is still yours.
            </p>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-cream">
                Which browser he opens pages in
              </span>
              <select
                value={draft("BROWSER") || "auto"}
                onChange={(e) => setDraft("BROWSER", e.target.value)}
                className="w-full rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 text-xs text-cream focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              >
                <option value="auto">Whichever he finds first</option>
                <option value="chrome">Google Chrome</option>
                <option value="edge">Microsoft Edge</option>
                <option value="firefox">Firefox</option>
                <option value="opera">Opera / Opera GX</option>
                <option value="brave">Brave</option>
              </select>
              <span className="mt-1 block text-[10px] text-sand-600">
                YouTube, searches, any page he opens — all of it goes here. If the
                one you pick isn&apos;t installed he falls back to the others
                rather than doing nothing.
              </span>
            </label>
            <SaveButton
              onClick={() => save("browser", { BROWSER: draft("BROWSER") || "auto" })}
              busy={busySection === "browser"}
              saved={savedSection === "browser"}
            />

            <div className="flex gap-1.5 rounded-full bg-black/30 p-1">
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
                        ? "bg-amber-500 text-white shadow-sm"
                        : "text-sand-500 hover:bg-amber-500/10"
                    }`}
                  >
                    {value === "on" ? "Allowed" : "Blocked"}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-sand-600">
              This permits opening Spotify, ordinary web pages, and files found by
              the search below — nothing else. No other protocols, and no general
              &quot;run a command&quot; ability behind it.
            </p>
          </Section>
          <Section
            icon={<FolderIcon className="h-4 w-4" />}
            title="Files"
            ok={(status?.fileRoots?.length ?? 0) > 0}
          >
            <p>
              Axis can find files in your own folders — ask him &quot;where&apos;s
              my tax return?&quot; or &quot;find the video I downloaded
              yesterday&quot; — and open what he finds. He can see where files are,
              not what is inside them.
            </p>
            {status?.fileRoots && status.fileRoots.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {status.fileRoots.map((root) => (
                  <span
                    key={root}
                    className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
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
            <p className="text-[10px] text-sand-600">
              Searching follows the Apps &amp; websites switch above — turn that off
              and file search goes with it.
            </p>
          </Section>
          <GroupHeading title="MEMORY" blurb="What he keeps, and what he did." />
          <Section
            icon={<MemoryIcon className="h-4 w-4" />}
            title="Memory"
            ok={memories.length > 0}
          >
            <p>
              Things Axis has learned about you, kept between sessions. He saves
              these himself as they come up — names, preferences, how you like things
              done — and you can ask him to forget any of them.
            </p>

            {memories.length === 0 ? (
              <p className="text-[11px] text-sand-600">
                Nothing yet. He&apos;ll start remembering as you talk.
              </p>
            ) : (
              <ul className="max-h-44 space-y-1 overflow-y-auto">
                {memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="group flex items-start gap-2 rounded-none bg-black/30 px-2.5 py-1.5"
                  >
                    <span className="flex-1 text-[11px] leading-relaxed text-cream">
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
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-sand-700 hover:bg-rose-500/10 hover:text-rose-400"
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
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-sand-500 hover:bg-white/[0.06]"
              >
                Forget everything
              </button>
            )}
          </Section>
          <Section
            icon={<ClockIcon className="h-4 w-4" />}
            title="Sessions & notes"
            ok={(status?.sessionDays ?? 0) > 0}
          >
            <MemoryPanel onChanged={onSaved} />
          </Section>
        </div>

        <p className="border-t border-amber-500/[0.13] px-6 py-3 text-[11px] text-sand-600">
          Keys are saved to data/settings.json on this computer only — never committed to
          git and never sent to the browser once saved.
        </p>
      </div>
    </div>
  );
}
