"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectWakeWord } from "@/lib/wakeWord";

// Always-on listening, done cheaply. The browser's own speech recognition runs
// continuously as a trigger only — it costs nothing and uploads nothing of
// ours. The moment it hears the name, the real pipeline takes over and
// transcribes the actual instruction properly.
//
// Chrome ends a recognition session on its own every minute or so, and after
// any silence, so "continuous" means restarting it forever.

/** Ignore further matches for this long after waking, to avoid double-fires. */
const REARM_MS = 2500;
/** Back-off after a failed start, so a broken service isn't hammered. */
const RETRY_MS = 2000;

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useWakeWord({
  enabled,
  paused,
  onWake,
}: {
  enabled: boolean;
  /** Held off while Axis is speaking or already listening for a command. */
  paused: boolean;
  onWake: (command: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWakeRef = useRef(0);
  const onWakeRef = useRef(onWake);
  // Read inside long-lived handlers, which would otherwise close over stale props.
  const activeRef = useRef(false);
  // The session restarts itself from its own onend handler, which means the
  // handler needs a reference to a function it is defined inside. A ref breaks
  // that cycle.
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    // Feature detection has to happen on the client, or the server and client
    // renders disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getConstructor() !== null);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor || recognitionRef.current) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";

    recognition.onresult = (event) => {
      if (Date.now() - lastWakeRef.current < REARM_MS) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript ?? "";
        const { woke, command } = detectWakeWord(transcript);
        if (!woke) continue;

        lastWakeRef.current = Date.now();
        setError(null);
        onWakeRef.current(command);
        return;
      }
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are ordinary in a listener that runs all
      // day; only a refusal is worth telling anyone about.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(
          "I can't listen for my name — microphone access is blocked. Click the padlock in the address bar and allow it."
        );
        activeRef.current = false;
      } else if (event.error === "network") {
        setError("Listening for my name needs the browser's speech service, which isn't reachable.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      // Chrome ends the session on its own schedule; keep it alive.
      if (activeRef.current) {
        timerRef.current = setTimeout(() => startRef.current(), 350);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      // Starting while a previous session is still closing throws; try again.
      recognitionRef.current = null;
      if (activeRef.current) timerRef.current = setTimeout(() => startRef.current(), RETRY_MS);
    }
  }, []);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (!(enabled && !paused && getConstructor() !== null)) {
      // Tearing the session down. The only state this touches is setting
      // "listening" to false, which is idempotent and can't cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop();
      return;
    }

    activeRef.current = true;
    // Started on a tick of its own rather than during the effect: it sets
    // state, and it must not race a session that is still shutting down from
    // the previous render.
    const timer = setTimeout(() => startRef.current(), 0);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [enabled, paused, stop]);

  return { supported, listening, error };
}
