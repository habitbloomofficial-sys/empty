"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked, sir. Click the padlock/camera icon in the address bar, allow the microphone, then try again.",
  "service-not-allowed":
    "Microphone access is blocked, sir. Click the padlock/camera icon in the address bar, allow the microphone, then try again.",
  "no-speech": "I didn't catch anything, sir — try again a little closer to the mic.",
  "audio-capture":
    "I can't find a working microphone, sir — check it's plugged in and not in use by another app.",
  network: "Voice recognition lost its network connection, sir.",
  aborted: "",
};

export function useSpeechRecognition(onFinalTranscript: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalTranscript);

  // Keep the ref current after every render rather than mutating it during
  // render, so recognition.onresult always calls the latest handler.
  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  });

  useEffect(() => {
    // Feature detection must run client-side only; this can't be a lazy
    // useState initializer without risking a server/client hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const start = useCallback(async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser, sir — try Chrome or Edge.");
      return;
    }

    setError(null);

    // Ask for the microphone explicitly first. This is what actually makes
    // the browser show its permission prompt reliably (rather than relying
    // on SpeechRecognition.start() to trigger it), and it lets us surface a
    // clear reason when the OS or browser has the mic blocked.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setError(
        "Microphone access is blocked, sir. Check your browser's site permissions and Windows' microphone privacy settings, then try again."
      );
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setInterimTranscript(interim);
      if (final.trim()) {
        onFinalRef.current(final.trim());
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setInterimTranscript("");
      const message = ERROR_MESSAGES[event.error];
      if (message) setError(message);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, isListening, interimTranscript, error, start, stop };
}
