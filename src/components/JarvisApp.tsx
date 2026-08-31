"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { SystemRail } from "./SystemRail";
import { ChatDock } from "./ChatDock";
import { TranscriptPanel } from "./TranscriptPanel";
import { SettingsModal } from "./SettingsModal";
import { HologramPanel } from "./HologramPanel";
import { ChatIcon, CloseIcon } from "./Icons";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoicePlayer } from "@/hooks/useVoicePlayer";
import { useWakeWord } from "@/hooks/useWakeWord";
import { detectStandbyOrder } from "@/lib/wakeWord";
import { describeClientFetchError, fetchWithRetry, postJson } from "@/lib/clientFetch";
import { catchphraseFor } from "@/lib/catchphrases";
import { screenUtterance, withinFollowUp } from "@/lib/speechGate";
import { nextGreeting } from "@/lib/greeting";
import { pickOffer } from "@/lib/offers";
import { SpeechChunker } from "@/lib/speechChunks";
import type { ActionLogEntry } from "@/lib/types";
import type { DeviceKind } from "@/lib/device";
import { SmallTalk, describeActions } from "@/lib/smallTalk";
import { banterFor } from "@/lib/banter";
import type { ChatMessage, IntegrationStatus, OrbState } from "@/lib/types";

const Orb = dynamic(() => import("./Orb"), { ssr: false });

const ORB_LABEL: Record<OrbState, string> = {
  idle: "At your service, sir.",
  listening: "Listening… I'll send when you pause.",
  thinking: "One moment, sir…",
  speaking: "Speaking…",
};

export default function AxisApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [hologramOpen, setHologramOpen] = useState(false);
  // Set when he has just designed something, so the projector opens onto the
  // part rather than an empty stage.
  const [hologramModel, setHologramModel] = useState<string | undefined>(undefined);
  const [hologramWeakPoint, setHologramWeakPoint] =
    useState<ActionLogEntry["weakPoint"]>(undefined);
  const [wakeEnabled, setWakeEnabled] = useState(true);
  // Standby: he keeps listening for his name and does nothing else. No
  // volunteering, no follow-ups without being addressed, no reacting to a
  // noise that half-sounded like a sentence.
  const [standby, setStandby] = useState(false);
  const [greetingPending, setGreetingPending] = useState(false);
  // What he remembers of where things stood. undefined until the session has
  // been opened; "" once opened with nothing worth saying.
  const [briefing, setBriefing] = useState<string | undefined>(undefined);
  // Which machine he is being used from. Taken from the session call rather
  // than the status call, because it arrives with the briefing — and the
  // greeting is spoken the moment the briefing lands, which is often before
  // the status has come back. Reading it from the later of the two is how
  // "I see you're on your phone" ends up never being said.
  const [device, setDevice] = useState<DeviceKind>("computer");
  const [recap, setRecap] = useState<{ line: string; case: string } | null>(null);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  // Hands-free: pressing the microphone opens it and leaves it open, so a
  // conversation is a conversation rather than a series of button presses.
  const [handsFree, setHandsFree] = useState(false);
  // Bumped when a reply finishes, which is the cue to start listening again.
  const [lastReplyAt, setLastReplyAt] = useState(0);
  // The last thing he decided wasn't for him, shown quietly so an unanswered
  // request never looks like a broken microphone.
  const [ignored, setIgnored] = useState<{ text: string; reason: string; at: number } | null>(null);

  const voicePlayer = useVoicePlayer();

  async function handleSend(text: string, transcribeMs?: number) {
    // "Axis, standby" is an instruction to Axis, not a question for the model.
    // Handled here rather than only in the wake listener so that typing it
    // works too, and so it never costs a request to answer.
    const order = detectStandbyOrder(text);
    if (order === "standby") {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user" as const, content: text, createdAt: Date.now() },
      ]);
      enterStandby();
      return;
    }
    if (order === "resume") {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user" as const, content: text, createdAt: Date.now() },
      ]);
      leaveStandby();
      return;
    }

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
    const fixed = catchphraseFor(text, status?.title ?? "sir");
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
        if (finished || spokenYet) return;
        // A line about what was actually asked for, where there is one — "One
        // moment, sir" fills the silence but says nothing.
        const line =
          banterFor(text, {
            title: status?.title ?? "sir",
            playful: status?.humour === "playful",
          }) ?? smallTalk.opener();
        speakChunk(line);
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
            if (event.log?.opens === "hologram") {
              setHologramModel(event.log.model);
              setHologramWeakPoint(event.log.weakPoint);
              setHologramOpen(true);
            }
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
      // server says "Failed to fetch" and nothing else, which reads as Axis
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

  /**
   * Everything the microphone produces, screened before it becomes a turn.
   *
   * With the microphone held open, most of what it hears is not for him: a
   * click, a cough, the television, you talking to someone else. Acting on any
   * of it is worse than missing a request, because he interrupts whatever he
   * was already saying to do it.
   */
  const handleHeard = async (text: string, transcribeMs?: number) => {
    // A recording you started by pressing the button is unambiguously meant
    // for him, whatever he happens to be doing. A microphone that simply never
    // closed is not, so that one has to earn it:
    //
    //   - straight after his own reply, a follow-up needs no name, because
    //     having to say "Axis" before every sentence isn't a conversation;
    //   - but cutting into a reply already under way always takes his name,
    //     since interrupting himself over a noise is the worst version of
    //     getting this wrong.
    const busy = voicePlayer.isSpeaking || isThinking;
    // Standby is exactly this: his name, every time, for everything. It is what
    // stops him answering the television.
    const requireName =
      standby || (handsFree && (busy || !withinFollowUp(lastReplyAt, Date.now())));

    const verdict = screenUtterance(text, { requireName });

    if (!verdict.act) {
      // Silently. An assistant announcing everything it decided to ignore is
      // just a different way of not leaving you alone.
      const at = Date.now();
      setIgnored({ text: text.trim(), reason: verdict.reason, at });
      // Clears itself, so the last thing he overheard isn't left on screen.
      setTimeout(() => setIgnored((current) => (current?.at === at ? null : current)), 6000);
      return;
    }
    setIgnored(null);
    await handleSend(verdict.text, transcribeMs);
  };

  const speech = useVoiceInput(
    handleHeard,
    Boolean(status?.transcription),
    status?.speechLang ?? "en-GB"
  );

  const enterStandby = useCallback(() => {
    setStandby(true);
    voicePlayer.stopSpeaking();
    speech.stop();
    setHandsFree(false);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: "Standing by.",
        createdAt: Date.now(),
      },
    ]);
    // Said, then silence — an acknowledgement is the one thing worth the
    // breath, and going quiet without a word looks like a fault.
    void voicePlayer.speak("Standing by.");
  }, [speech, voicePlayer]);

  const leaveStandby = useCallback(() => {
    setStandby(false);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: "Here, sir.",
        createdAt: Date.now(),
      },
    ]);
    void voicePlayer.speak("Here, sir.");
  }, [voicePlayer]);

  // Wake word. Held off while he's speaking or already listening, so he never
  // hears his own name in his own voice and wakes himself up.
  const wake = useWakeWord({
    enabled: wakeEnabled,
    paused: voicePlayer.isSpeaking || speech.isListening || speech.isTranscribing || isThinking,
    lang: status?.speechLang ?? "en-GB",
    onWake: (command) => {
      const order = detectStandbyOrder(`axis ${command}`);

      if (order === "standby") {
        enterStandby();
        return;
      }
      // Any address at all brings him back: being told to wake up is the point
      // of a wake word, and "Axis" alone is how anyone would do it.
      if (standby) {
        leaveStandby();
        if (command.trim().length > 2 && order !== "resume") void handleSend(command.trim());
        return;
      }
      if (order === "resume") return;   // Already awake; nothing to do.

      // "Hey Axis, open YouTube" shouldn't need saying twice — if the
      // instruction came in the same breath, act on it directly.
      if (command.trim().length > 2) void handleSend(command.trim());
      else void speech.start();
    },
  });

  useEffect(() => {
    // Opening Axis opens a session. He works out whether this is a new day,
    // a session being picked up, or one that stopped without saying so, and
    // hands back a line about where things stood — which is the difference
    // between an assistant who greets you and one who remembers you.
    let cancelled = false;
    (async () => {
      try {
        const data = await postJson<{
          briefing?: string;
          case?: string;
          date?: string;
          device?: { kind?: DeviceKind };
          previous?: { date: string; summary: string } | null;
        }>(
          "/api/session",
          { action: "open" }
        );
        if (cancelled) return;
        const line = typeof data.briefing === "string" ? data.briefing : "";
        if (data.device?.kind) setDevice(data.device.kind);
        setBriefing(line);
        if (typeof data.date === "string") setSessionDate(data.date);
        // Shown as well as spoken. He has remembered this all along; not
        // putting it on screen was the reason it never felt like it.
        if (line) setRecap({ line, case: data.case ?? "" });
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
    // Shaped by the machine he is on: on a phone he says so, and offers the
    // kind of thing that is useful away from the desk.
    const greeting = nextGreeting(device, status);
    // Sometimes he offers to do something rather than waiting to be asked —
    // but only ever something he can actually do, never when he already has
    // something to tell you, and never on top of a greeting that has asked a
    // question of its own. Two openings at once is a speech.
    const offer = briefing || greeting.asks ? null : pickOffer(status);
    const line = briefing
      ? `${greeting.line} ${briefing}`
      : offer
        ? `${greeting.line} ${offer}`
        : greeting.line;

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
    const timer = setTimeout(() => void speech.start({ continuous: true }), 400);
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

  // ---------------------------------------------------------------------
  // Him speaking first.
  //
  // Every minute the server is asked whether anything is worth mentioning; it
  // almost always says no, and enforces the real interval itself so three open
  // tabs don't produce three remarks. Nothing is invented server-side — if it
  // found no facts, there is nothing to say and it says so.
  //
  // Two things it must never do: talk over him, and talk over itself. So it
  // waits for a genuinely idle moment, which is what every clause below is.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!status?.idleTalk || standby) return;

    let stopped = false;

    const look = async () => {
      if (stopped) return;
      if (
        isThinking ||
        voicePlayer.isSpeaking ||
        speech.isListening ||
        speech.isTranscribing ||
        settingsOpen ||
        document.hidden
      ) {
        return;
      }

      let say: string | null = null;
      try {
        const res = await fetch("/api/notice", { method: "POST" });
        if (!res.ok) return;
        say = ((await res.json()) as { say: string | null }).say;
      } catch {
        return;   // Offline, or he closed the window mid-request.
      }
      if (!say || stopped) return;

      // Checked again: a minute may have passed inside that request, and he may
      // have started talking in it.
      if (isThinking || voicePlayer.isSpeaking || speech.isListening) return;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant" as const, content: say!, createdAt: Date.now() },
      ]);
      void voicePlayer.speak(say);
    };

    const timer = setInterval(() => void look(), 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    status?.idleTalk,
    standby,
    isThinking,
    settingsOpen,
    voicePlayer,
    speech.isListening,
    speech.isTranscribing,
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

      <SystemRail status={status} state={orbState} sessionDate={sessionDate} />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 xl:pr-[224px]">
        <div className="animate-float relative h-[min(92vw,420px)] w-[min(92vw,420px)] sm:h-[560px] sm:w-[560px]">
          <Orb state={orbState} audioLevel={orbLevel} />
        </div>

        <p className="mt-2 text-sm font-medium text-sand-500">
          {speech.isTranscribing ? "Transcribing…" : ORB_LABEL[orbState]}
        </p>

        {(speech.error || error || voiceError) && (
          <div className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-rose-400">
            {speech.error || error || voiceError}
          </div>
        )}

        {recap && (
          <div className="glass mt-3 w-full max-w-md rounded-none px-4 py-3 text-left">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/70">
                {recap.case === "recovery" ? "We were interrupted" : "Where we left off"}
              </span>
              {status?.device?.kind && status.device.kind !== "computer" && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  on {status.device.kind}
                </span>
              )}
              <button
                type="button"
                onClick={() => setRecap(null)}
                className="ml-auto rounded px-1.5 text-[10px] font-semibold text-sand-700 hover:bg-white/[0.06]"
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs leading-relaxed text-cream">{recap.line}</p>
          </div>
        )}

        {/* Heard, and deliberately not answered. Worth showing, briefly and
            quietly: without it an ignored request is indistinguishable from a
            microphone that has stopped working. */}
        {ignored?.reason === "not-addressed" && (
          <div className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-sand-500">
            Heard “{ignored.text.slice(0, 60)}” — start with <b>“Hey Axis”</b> if that
            was meant for me.
          </div>
        )}

        {greetingPending && (
          <div className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-sand-500">
            Click anywhere and I&apos;ll say hello, sir — your browser won&apos;t let me
            speak until you&apos;ve touched the page.
          </div>
        )}

        {wake.error && (
          <div className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-amber-700">
            {wake.error}
          </div>
        )}

        {!voiceError && voicePlayer.fallbackNotice && (
          <div className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-amber-700">
            {voicePlayer.fallbackNotice}
          </div>
        )}

        {status && !status.brain && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="glass mt-3 max-w-md rounded-none px-4 py-2 text-center text-xs text-sand-500 transition hover:text-amber-400"
          >
            No brain connected yet, sir — open <span className="font-semibold">Settings</span> and
            paste a Gemini or OpenAI API key.
          </button>
        )}
      </main>

      <div className="relative z-10 w-full px-4 pb-6 sm:pb-8 xl:pr-[240px]">
        <ChatDock
          onSend={handleSend}
          wakeSupported={wake.supported}
          wakeEnabled={wakeEnabled}
          wakeListening={wake.listening}
          wakeLastHeard={wake.lastHeard}
          onToggleWake={() => setWakeEnabled((v) => !v)}
          standby={standby}
          onLeaveStandby={leaveStandby}
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
              setIgnored(null);
              void speech.start({ continuous: true });
            }
          }}
        />
      </div>

      <button
        onClick={() => setTranscriptOpen((v) => !v)}
        className="glass fixed bottom-24 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full text-amber-400 shadow-lg sm:bottom-8 sm:right-8"
        aria-label="Toggle transcript"
      >
        {transcriptOpen ? <CloseIcon className="h-4 w-4" /> : <ChatIcon className="h-[18px] w-[18px]" />}
        {messages.length > 0 && !transcriptOpen && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
        )}
      </button>

      <AnimatePresence>
        {transcriptOpen && (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="glass-strong fixed inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col rounded-none"
          >
            <div className="flex items-center justify-between border-b border-amber-500/[0.13] px-4 py-3">
              <h2 className="font-display text-sm font-semibold tracking-wide text-cream">
                Transcript
              </h2>
              <button
                onClick={() => setTranscriptOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sand-500 hover:bg-amber-500/10"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <TranscriptPanel messages={messages} />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hologramOpen && (
          <HologramPanel
            modelPath={hologramModel}
            weakPoint={hologramWeakPoint}
            onClose={() => {
              setHologramOpen(false);
              setHologramModel(undefined);
              setHologramWeakPoint(undefined);
            }}
          />
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
