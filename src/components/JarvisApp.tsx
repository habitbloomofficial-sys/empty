"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { ChatDock } from "./ChatDock";
import { TranscriptPanel } from "./TranscriptPanel";
import { SettingsModal } from "./SettingsModal";
import { HologramPanel } from "./HologramPanel";
import { ChatIcon, CloseIcon } from "./Icons";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoicePlayer } from "@/hooks/useVoicePlayer";
import { useWakeWord } from "@/hooks/useWakeWord";
import { describeClientFetchError, fetchWithRetry, postJson } from "@/lib/clientFetch";
import { catchphraseFor } from "@/lib/catchphrases";
import { nextGreeting } from "@/lib/greeting";
import { SpeechChunker } from "@/lib/speechChunks";
import { SmallTalk, describeActions } from "@/lib/smallTalk";
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
  const [hologramOpen, setHologramOpen] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [greetingPending, setGreetingPending] = useState(false);
  // What he remembers of where things stood. undefined until the session has
  // been opened; "" once opened with nothing worth saying.
  const [briefing, setBriefing] = useState<string | undefined>(undefined);
  // Hands-free: pressing the microphone opens it and leaves it open, so a
  // conversation is a conversation rather than a series of button presses.
  const [handsFree, setHandsFree] = useState(false);
  // Bumped when a reply finishes, which is the cue to start listening again.
  const [lastReplyAt, setLastReplyAt] = useState(0);

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

    // Some things have exactly one right answer. A model told to "always say
    // exactly this" mostly obliges and occasionally embellishes, which is the
    // one thing a catchphrase can't survive — so it's answered here instead,
    // word for word and with no round trip at all.
    const fixed = catchphraseFor(text);
    if (fixed) {
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant" as const, content: fixed, createdAt: Date.now() },
      ]);
      voicePlayer
        .speak(fixed, undefined, () => recordSpeakTiming(assistantId, sentAt))
        .catch(() => undefined)
        .finally(() => setLastReplyAt(Date.now()));
      return;
    }

    setIsThinking(true);

    const chunker = new SpeechChunker();
    const smallTalk = new SmallTalk(status?.title ?? "sir", status?.humour === "playful");
    let spokenYet = false;
    let assistantStarted = false;
    let finished = false;
    const fillerTimers: ReturnType<typeof setTimeout>[] = [];
    const stopFillers = () => {
      finished = true;
      fillerTimers.forEach(clearTimeout);
      fillerTimers.length = 0;
    };

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

    // He talks on his own clock rather than the model's. Nothing has been
    // spoken by now, so say something — the model may still be thinking, and
    // thinking produces no tokens at all.
    fillerTimers.push(
      setTimeout(() => {
        if (!finished && !spokenYet) speakChunk(smallTalk.opener());
      }, 600)
    );
    // And again if it drags on, so a long job isn't a long silence.
    for (const delay of [9000, 20000]) {
      fillerTimers.push(
        setTimeout(() => {
          if (!finished && !voicePlayer.isSpeaking) speakChunk(smallTalk.stillWorking());
        }, delay)
      );
    }

    /** Create the assistant bubble on first output, then keep appending. */
    const appendText = (delta: string) => {
      setIsThinking(false);

      // Flipped here rather than inside the updater below. React runs updaters
      // when it renders, not when they're queued — and the last text event and
      // the closing one usually arrive in the same network chunk, so a flag set
      // in there is still false when the closing event reads it, and the reply
      // gets spoken a second time.
      const first = !assistantStarted;
      assistantStarted = true;

      setMessages((prev) =>
        first
          ? [
              ...prev,
              {
                id: assistantId,
                role: "assistant" as const,
                content: delta,
                createdAt: Date.now(),
                timings: { transcribe: transcribeMs },
              },
            ]
          : prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
      );
    };

    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetchWithRetry("/api/chat", {
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
            // Real words are on the way; the stand-ins have done their job.
            stopFillers();
            appendText(event.delta);
            for (const chunk of chunker.push(event.delta)) speakChunk(chunk);
            // A flush marks text that shouldn't wait for a full sentence to
            // accumulate — an acknowledgement spoken while the action runs.
            if (event.flush) {
              const now = chunker.flush();
              if (now) speakChunk(now);
            }
          } else if (event.type === "action") {
            // Some tools act on this interface rather than on the machine.
            if (event.log?.opens === "hologram") setHologramOpen(true);
            // Shown the moment it happens — the action is already done.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, actions: [...(m.actions ?? []), event.log] }
                  : m
              )
            );
          } else if (event.type === "done") {
            stopFillers();
            const tail = chunker.flush();
            if (tail) speakChunk(tail);
            setIsThinking(false);
            setMessages((prev) => {
              const updated = prev.map((m) =>
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
                ? updated
                : [
                    ...updated,
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
            if (!assistantStarted && event.reply) {
              speakChunk(event.reply);
            } else if (!event.reply?.trim()) {
              // Did something and said nothing about it. Report it in his own
              // voice from what the tools actually reported back.
              const summary = describeActions(
                ((event.actions ?? []) as { summary?: string; ok?: boolean }[])
                  .filter((a) => a.ok)
                  .map((a) => a.summary ?? ""),
                status?.title ?? "sir"
              );
              if (summary) {
                appendText(assistantStarted ? ` ${summary}` : summary);
                speakChunk(summary);
              }
            }
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      stopFillers();
      setIsThinking(false);
      // Same treatment as the Settings panel: a request that never reached the
      // server says "Failed to fetch" and nothing else, which reads as JARVIS
      // being broken rather than the terminal having been closed.
      setError(describeClientFetchError(err));
    } finally {
      stopFillers();
      setLastReplyAt(Date.now());
    }
  }

  function recordSpeakTiming(assistantId: string, sentAt: number) {
    const speakMs = Date.now() - sentAt;
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, timings: { ...m.timings, speak: speakMs } } : m))
    );
  }

  const speech = useVoiceInput(handleSend, Boolean(status?.transcription));

  // Wake word. Held off while he's speaking or already listening, so he never
  // hears his own name in his own voice and wakes himself up.
  const wake = useWakeWord({
    enabled: wakeEnabled,
    paused: voicePlayer.isSpeaking || speech.isListening || speech.isTranscribing || isThinking,
    onWake: (command) => {
      // "Hey Jarvis, open YouTube" shouldn't need saying twice — if the
      // instruction came in the same breath, act on it directly.
      if (command.trim().length > 2) void handleSend(command.trim());
      else void speech.start();
    },
  });

  useEffect(() => {
    // Opening JARVIS opens a session. He works out whether this is a new day,
    // a session being picked up, or one that stopped without saying so, and
    // hands back a line about where things stood — which is the difference
    // between an assistant who greets you and one who remembers you.
    let cancelled = false;
    (async () => {
      try {
        const data = await postJson<{ briefing?: string }>("/api/session", { action: "open" });
        if (!cancelled) setBriefing(typeof data.briefing === "string" ? data.briefing : "");
      } catch {
        // No briefing is a worse greeting, not a broken app — let him speak.
        if (!cancelled) setBriefing("");
      }
    })();

    // Closing the tab is a pause, not a crash — say so on the way out. A
    // beacon is the only request the browser promises to finish during unload.
    const pause = () => {
      navigator.sendBeacon?.(
        "/api/session",
        new Blob([JSON.stringify({ action: "pause" })], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", pause);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", pause);
    };
  }, []);

  useEffect(() => {
    // Greet on arrival. Browsers refuse to play audio before you've interacted
    // with the page, so if that refusal happens we wait for the first click or
    // keypress and greet then, rather than silently skipping it.
    //
    // Held until the briefing has been fetched (or failed), so the greeting and
    // what he remembers arrive as one sentence rather than two.
    if (briefing === undefined) return;

    let greeted = false;
    const greeting = nextGreeting();
    const line = briefing ? `${greeting} ${briefing}` : greeting;

    const say = async () => {
      if (greeted) return;
      greeted = true;
      let heard = false;
      try {
        await voicePlayer.speak(line, undefined, () => {
          heard = true;
          // Shown only once it's actually been said, so a greeting the browser
          // silenced never appears as though it was.
          setMessages((prev) =>
            prev.length === 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content: line,
                    createdAt: Date.now(),
                  },
                ]
              : prev
          );
        });
      } catch {
        /* falls through to the retry below */
      }
      if (!heard) {
        greeted = false;
        setGreetingPending(true);
        const retry = () => {
          setGreetingPending(false);
          void say();
        };
        window.addEventListener("pointerdown", retry, { once: true });
        window.addEventListener("keydown", retry, { once: true });
      }
    };

    const timer = setTimeout(() => void say(), 300);
    return () => clearTimeout(timer);
    // Runs once the briefing has landed; voicePlayer is stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefing]);

  useEffect(() => {
    if (!handsFree) return;
    if (
      voicePlayer.isSpeaking ||
      isThinking ||
      speech.isListening ||
      speech.isTranscribing ||
      speech.error
    ) {
      return;
    }
    // A beat after he stops, so the tail of his own voice never lands in the
    // recording and get transcribed back as if you had said it.
    const timer = setTimeout(() => void speech.start(), 400);
    return () => clearTimeout(timer);
    // lastReplyAt is the trigger: it changes when a turn ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handsFree,
    lastReplyAt,
    voicePlayer.isSpeaking,
    isThinking,
    speech.isListening,
    speech.isTranscribing,
    speech.error,
  ]);

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
      <TopBar
        status={status}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHologram={() => setHologramOpen(true)}
      />

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

        {greetingPending && (
          <div className="glass mt-3 max-w-md rounded-xl px-4 py-2 text-center text-xs text-ink-700/70">
            Click anywhere and I&apos;ll say hello, sir — your browser won&apos;t let me
            speak until you&apos;ve touched the page.
          </div>
        )}

        {wake.error && (
          <div className="glass mt-3 max-w-md rounded-xl px-4 py-2 text-center text-xs text-amber-700">
            {wake.error}
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
          wakeSupported={wake.supported}
          wakeEnabled={wakeEnabled}
          wakeListening={wake.listening}
          onToggleWake={() => setWakeEnabled((v) => !v)}
          disabled={isThinking}
          isListening={speech.isListening}
          isTranscribing={speech.isTranscribing}
          micSupported={speech.supported}
          micLevel={speech.micLevel}
          interimTranscript={speech.interimTranscript}
          // Derived rather than stored: a microphone that has failed must not
          // keep showing as on, and the restart below stands down for the same
          // reason.
          handsFree={handsFree && !speech.error}
          onToggleMic={() => {
            // One button, one meaning: on turns the microphone on and leaves
            // it on, off turns it off. Nothing in between to remember.
            if (handsFree || speech.isListening) {
              setHandsFree(false);
              speech.stop();
            } else {
              setHandsFree(true);
              void speech.start();
            }
          }}
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
        {hologramOpen && <HologramPanel onClose={() => setHologramOpen(false)} />}
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
