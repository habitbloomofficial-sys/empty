"use client";

import { useCallback, useEffect, useState } from "react";
import { describeClientFetchError, postJson } from "@/lib/clientFetch";

// The readable half of Axis's memory: what happened, and the two files you
// can edit yourself. Facts have their own list above this; sessions are shown
// but never edited here — a history you can rewrite is not a history.

interface RecapEntry {
  time: string;
  text: string;
}

interface SessionLog {
  date: string;
  status: "open" | "paused" | "closed";
  opened: string;
  recap: RecapEntry[];
}

const STATUS_LABEL: Record<SessionLog["status"], string> = {
  open: "In progress",
  paused: "Paused",
  closed: "Closed",
};

function Editor({
  label,
  hint,
  value,
  onChange,
  onSave,
  busy,
  saved,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  busy: boolean;
  saved: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-cream">{label}</span>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="ml-auto rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-amber-400 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[10px] font-medium text-amber-400">Saved ✓</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full resize-y rounded-none border border-amber-500/20 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-cream focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
      />
      <span className="mt-1 block text-[10px] text-sand-600">{hint}</span>
    </div>
  );
}

export function MemoryPanel({ onChanged }: { onChanged: () => void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [session, setSession] = useState<SessionLog | null>(null);
  const [user, setUser] = useState("");
  const [notes, setNotes] = useState("");
  const [learned, setLearned] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const data = await res.json();
      setDates(Array.isArray(data.dates) ? data.dates : []);
      setSelected((current) => current ?? data.date ?? null);
      setSession(data.today ?? null);
    } catch (err) {
      setError(describeClientFetchError(err));
    }
  }, []);

  useEffect(() => {
    // Both reads in one async pass: nothing here should touch state until its
    // fetch has actually come back.
    (async () => {
      await loadIndex();
      try {
        const res = await fetch("/api/memory/files", { cache: "no-store" });
        const data = await res.json();
        setUser(typeof data.user === "string" ? data.user : "");
        setNotes(typeof data.notes === "string" ? data.notes : "");
        setLearned(typeof data.learned === "string" ? data.learned : "");
      } catch {
        /* the session list above is still useful on its own */
      }
    })();
  }, [loadIndex]);

  // Load whichever day is selected, so the timeline is browsable.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/memory/files?session=${selected}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setSession(data.session ?? null);
      } catch {
        /* leave whatever was already shown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function saveLayer(layer: "user" | "notes" | "learned", text: string) {
    setBusy(layer);
    setSaved(null);
    setError(null);
    try {
      await postJson("/api/memory/files", { layer, text }, { method: "PUT" });
      setSaved(layer);
      onChanged();
    } catch (err) {
      setError(describeClientFetchError(err));
    } finally {
      setBusy(null);
    }
  }

  async function closeToday() {
    setBusy("close");
    setError(null);
    try {
      await postJson("/api/session", { action: "close" });
      await loadIndex();
      onChanged();
    } catch (err) {
      setError(describeClientFetchError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-none bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-400">{error}</p>
      )}

      <p>
        A dated record of what you and Axis actually did, written as it happens.
        He reads the last of it when you open him, so he can pick up where you
        left off — and he can search all of it when you ask what happened when.
      </p>

      {dates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dates.slice(0, 10).map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                selected === date
                  ? "bg-amber-500 text-white"
                  : "bg-black/30 text-sand-500 hover:bg-amber-500/10"
              }`}
            >
              {date}
            </button>
          ))}
        </div>
      )}

      {session ? (
        <div className="rounded-none bg-black/30 p-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold text-sand-500">
            <span>
              {session.date} · opened {session.opened}
            </span>
            <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">
              {STATUS_LABEL[session.status]}
            </span>
          </div>
          {session.recap.length === 0 ? (
            <p className="text-[11px] text-sand-600">Nothing recorded yet.</p>
          ) : (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {session.recap.map((entry, i) => (
                <li key={`${entry.time}-${i}`} className="text-[11px] leading-relaxed text-cream">
                  <span className="mr-1.5 font-mono text-[10px] text-sand-700">{entry.time}</span>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-sand-600">No session recorded for that day.</p>
      )}

      <button
        type="button"
        onClick={closeToday}
        disabled={busy === "close"}
        className="rounded-full px-3 py-1.5 text-xs font-semibold text-sand-500 hover:bg-white/[0.06] disabled:opacity-40"
      >
        {busy === "close" ? "Closing…" : "Close today's session"}
      </button>

      <Editor
        label="About me"
        hint="Read at the start of every conversation. Who you are, how you like things done."
        value={user}
        onChange={setUser}
        onSave={() => void saveLayer("user", user)}
        busy={busy === "user"}
        saved={saved === "user"}
      />

      <Editor
        label="Notes and lessons"
        hint="Things that went wrong once already. He adds to this himself as he learns."
        value={notes}
        onChange={setNotes}
        onSave={() => void saveLayer("notes", notes)}
        busy={busy === "notes"}
        saved={saved === "notes"}
      />

      <Editor
        label="What he has learned"
        hint="Facts he looked up, and ways of working he picked up. Anything off the web can be wrong — correct or delete a line and that is what he knows."
        value={learned}
        onChange={setLearned}
        onSave={() => void saveLayer("learned", learned)}
        busy={busy === "learned"}
        saved={saved === "learned"}
      />

      <p className="text-[10px] text-sand-600">
        All of this lives in <code>data/memory/</code> as plain Markdown — open the
        folder and edit it in Notepad if you prefer. Nothing is sent anywhere; it
        never leaves this computer.
      </p>
    </div>
  );
}
