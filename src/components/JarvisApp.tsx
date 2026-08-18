"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { ChatDock } from "./ChatDock";
import { TranscriptPanel } from "./TranscriptPanel";
import { SettingsModal } from "./SettingsModal";
import { ChatIcon, CloseIcon } from "./Icons";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoicePlayer } from "@/hooks/useVoicePlayer";
import { SpeechChunker } from "@/lib/speechChunks";
import type { ChatMessage, IntegrationStatus, OrbState } from "@/lib/types";

const Orb = dynamic(() => import("./Orb"), { ssr: false });

const ORB_LABEL: Record<OrbState, string> = {
  idle: "At your service, sir.",
  listening: "Listening… I'll send when you pause.",
  thinking: "One moment, sir…",
  speaking: "Speaking…",
};

export default function JarvisApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const voicePlayer = useVoicePlayer();

  async function handleSend(text: string, transcribeMs?: number) {
    setError(null);
    setVoiceError(null);
    // A new question cuts off the previous answer mid-sentence rather than
    // queueing behind it.
    voicePlayer.beginTurn();

    const sentAt = Date.now();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [...prev, userMsg]);
    setTranscriptOpen(true);
    setIsThinking(true);

    const chunker = new SpeechChunker();
    let spokenYet = false;
    let assistantStarted = false;

    /** Speak a finished sentence, and record when the first sound arrived. */
    const speakChunk = (chunk: string) => {
      const first = !spokenYet;
      spokenYet = true;
      voicePlayer
        .speakQueued(chunk, first ? () => recordSpeakTiming(assistantId, sentAt) : undefined)
        .catch((err: unknown) => {
          setVoiceError(
            `I can't speak aloud right now: ${err instanceof Error ? err.message : String(err)}`
          );
        });
    };

    /** Create the assistant bubble on first output, then keep appending. */
    const appendText = (delta: string) => {
      setIsThinking(false);
      setMessages((prev) => {
        if (!assistantStarted) {
          assistantStarted = true;
          return [
            ...prev,
            {
              id: assistantId,
              role: "assistant" as const,
              content: delta,
              createdAt: Date.now(),
              timings: { transcribe: transcribeMs },
            },
          ];
        }
        return prev.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + delta } : m
        );
      });
    };

    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || "Something went wrong, sir.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Newline-delimited JSON, one event per line.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "text") {
            appendText(event.delta);
            for (const chunk of chunker.push(event.delta)) speakChunk(chunk);
          } else if (event.type === "action") {
            // Shown the moment it happens — the action is already done.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, actions: [...(m.actions ?? []), event.log] }
                  : m
              )
            );
          } else if (event.type === "done") {
            const tail = chunker.flush();
            if (tail) speakChunk(tail);
            setIsThinking(false);
            setMessages((prev) => {
              const finished = prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: event.reply || m.content,
                      actions: m.actions ?? event.actions,
                      timings: {
                        ...m.timings,
                        ...event.timings,
                        transcribe: transcribeMs,
                        total: Date.now() - sentAt,
                      },
                    }
                  : m
              );
              // A reply with no text at all still deserves a bubble.
              return assistantStarted
                ? finished
                : [
                    ...finished,
                    {
                      id: assistantId,
                      role: "assistant" as const,
                      content: event.reply || "…",
                      createdAt: Date.now(),
                      actions: event.actions,
                      timings: {
                        ...event.timings,
                        transcribe: transcribeMs,
                        total: Date.now() - sentAt,
                      },
                    },
                  ];
            });
            if (!assistantStarted && event.reply) speakChunk(event.reply);
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      setIsThinking(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function recordSpeakTiming(assistantId: string, sentAt: number) {
    const speakMs = Date.now() - sentAt;
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, timings: { ...m.timings, speak: speakMs } } : m))
    );
  }

  const speech = useVoiceInput(handleSend, Boolean(status?.transcription));

  const orbState: OrbState = voicePlayer.isSpeaking
    ? "speaking"
    : isThinking || speech.isTranscribing
      ? "thinking"
      : speech.isListening
        ? "listening"
        : "idle";

  // While listening, the orb pulses with your voice — immediate proof that the
  // microphone is being picked up.
  const orbLevel = speech.isListening ? speech.micLevel : voicePlayer.audioLevel;

  const refreshStatus = useMemo(
    () => async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        setStatus(await res.json());
      } catch {
        /* status is best-effort */
      }
    },
    []
  );

  useEffect(() => {
    // Fetching integration status on mount, and re-checking after the Gmail
    // OAuth redirect returns — a standard "sync with server" data fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStatus();
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (gmail) {
      window.history.replaceState({}, "", window.location.pathname);
      setSettingsOpen(true);
      if (gmail === "error") {
        setError(
          `Gmail couldn't be connected: ${
            params.get("reason") || "Google didn't say why."
          }`
        );
      }
      refreshStatus();
    }
  }, [refreshStatus]);

  useEffect(() => {
    // Re-check status whenever Settings opens, in case something changed
    // (e.g. .env.local was edited and the server restarted).
    if (settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshStatus();
    }
  }, [settingsOpen, refreshStatus]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <TopBar status={status} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4">
        <div className="animate-float relative h-[min(60vw,340px)] w-[min(60vw,340px)] sm:h-[380px] sm:w-[380px]">
          <Orb state={orbState} audioLevel={orbLevel} />
        </div>

        <p className="mt-2 text-sm font-medium text-ink-700/70">
          {speech.isTranscribing ? "Transcribing…" : ORB_LABEL[orbState]}
        </p>

        {(speech.error || error || voiceError) && (
          <div className="glass mt-3 max-w-md rounded-xl px-4 py-2 text-center text-xs text-rose-600">
            {speech.error || error || voiceError}
          </div>
        )}

        {!voiceError && voicePlayer.fallbackNotice && (
          <div className="glass mt-3 max-w-md rounded-xl px-4 py-2 text-center text-xs text-amber-700">
            {voicePlayer.fallbackNotice}
          </div>
        )}

        {status && !status.brain && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="glass mt-3 max-w-md rounded-xl px-4 py-2 text-center text-xs text-ink-700/70 transition hover:text-sky-700"
          >
            No brain connected yet, sir — open <span className="font-semibold">Settings</span> and
            paste a Gemini or OpenAI API key.
          </button>
        )}
      </main>

      <div className="relative z-10 w-full px-4 pb-6 sm:pb-8">
        <ChatDock
          onSend={handleSend}
          disabled={isThinking}
          isListening={speech.isListening}
          isTranscribing={speech.isTranscribing}
          micSupported={speech.supported}
          micLevel={speech.micLevel}
          interimTranscript={speech.interimTranscript}
          onToggleMic={() => (speech.isListening ? speech.stop() : speech.start())}
        />
      </div>

      <button
        onClick={() => setTranscriptOpen((v) => !v)}
        className="glass fixed bottom-24 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full text-sky-600 shadow-lg sm:bottom-8 sm:right-8"
        aria-label="Toggle transcript"
      >
        {transcriptOpen ? <CloseIcon className="h-4 w-4" /> : <ChatIcon className="h-[18px] w-[18px]" />}
        {messages.length > 0 && !transcriptOpen && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sky-500" />
        )}
      </button>

      <AnimatePresence>
        {transcriptOpen && (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="glass-strong fixed inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col rounded-l-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/60 px-4 py-3">
              <h2 className="font-display text-sm font-semibold tracking-wide text-ink-900">
                Transcript
              </h2>
              <button
                onClick={() => setTranscriptOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-700 hover:bg-sky-500/10"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <TranscriptPanel messages={messages} />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            status={status}
            onClose={() => setSettingsOpen(false)}
            onSaved={refreshStatus}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
