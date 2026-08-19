"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toMonoWav } from "@/lib/audio";
import { describeClientFetchError } from "@/lib/clientFetch";

// Two ways to hear you, in order of preference:
//
// 1. "recording" — capture with MediaRecorder and transcribe on the server.
//    Works in every browser, auto-detects the spoken language, and gives us a
//    live input level so you can see the mic is actually picking you up.
// 2. "speech-api" — the browser's built-in SpeechRecognition. Chrome/Edge only,
//    needs Google's speech service, and is pinned to the browser's locale, so
//    it's the fallback for when no transcription key is configured.
export type VoiceInputMode = "recording" | "speech-api";

const SILENCE_HANG_MS = 1400; // quiet time after speech before we auto-submit
const NO_SPEECH_TIMEOUT_MS = 9000; // give up if nothing is said at all
const MAX_RECORDING_MS = 60000;
const SPEECH_LEVEL = 0.055; // RMS above this counts as "you're talking"
const SILENCE_LEVEL = 0.03;
const MIN_AUDIO_BYTES = 1200; // smaller than this is silence, not speech

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mimeType: string | undefined): string {
  if (!mimeType) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked, sir. Click the padlock icon at the left of the address bar, set Microphone to Allow, then reload the page.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "I can't find a microphone, sir — check one is plugged in and enabled in Windows sound settings.";
    case "NotReadableError":
      return "Your microphone is busy in another app, sir — close Teams/Zoom/Discord and try again.";
    default:
      return "I couldn't open the microphone, sir. Check Windows Settings → Privacy → Microphone allows desktop apps, then try again.";
  }
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
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
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
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

const SPEECH_API_ERRORS: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked, sir. Click the padlock icon in the address bar, set Microphone to Allow, then reload.",
  "service-not-allowed":
    "This browser's speech service refused the request, sir — add a Gemini or ElevenLabs API key in Settings and I'll transcribe it myself instead.",
  "no-speech": "I didn't catch anything, sir — try again a little closer to the mic.",
  "audio-capture":
    "I can't find a working microphone, sir — check it's plugged in and not in use by another app.",
  network:
    "The browser's speech service is unreachable, sir — add a Gemini or ElevenLabs API key in Settings and I'll transcribe it myself instead.",
  aborted: "",
};

export function useVoiceInput(
  onFinalTranscript: (text: string, transcribeMs?: number) => void,
  canTranscribeOnServer: boolean
) {
  const [speechApiAvailable, setSpeechApiAvailable] = useState(false);
  const [recorderAvailable, setRecorderAvailable] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onFinalRef = useRef(onFinalTranscript);
  const canTranscribeRef = useRef(canTranscribeOnServer);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const modeRef = useRef<VoiceInputMode | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
    canTranscribeRef.current = canTranscribeOnServer;
  });

  useEffect(() => {
    // Feature detection has to be client-side, or the server render and the
    // first client render disagree and React reports a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechApiAvailable(getSpeechRecognitionCtor() !== null);
    setRecorderAvailable(
      typeof MediaRecorder !== "undefined" &&
        typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);

  const teardownAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    ctx?.close().catch(() => {
      /* already closed */
    });
    setMicLevel(0);
  }, []);

  useEffect(() => teardownAudio, [teardownAudio]);

  const startRecording = useCallback(
    async (stream: MediaStream) => {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const wasCancelled = cancelledRef.current;
        teardownAudio();
        setIsListening(false);
        recorderRef.current = null;
        modeRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        chunksRef.current = [];

        if (wasCancelled) return;
        if (blob.size < MIN_AUDIO_BYTES) {
          setError("I didn't catch anything, sir — try again a little closer to the mic.");
          return;
        }

        setIsTranscribing(true);
        const transcribeStart = performance.now();
        try {
          // WAV is the one format every transcription service accepts; fall
          // back to the raw recording if this browser can't decode its own.
          const wav = await toMonoWav(blob);
          const upload = wav ?? blob;
          const filename = wav ? "speech.wav" : `speech.${extensionFor(mimeType)}`;

          const form = new FormData();
          form.append("audio", upload, filename);
          let res: Response;
          try {
            res = await fetch("/api/transcribe", { method: "POST", body: form });
          } catch (err) {
            throw new Error(describeClientFetchError(err));
          }
          // A failing route can answer with an HTML error page, and calling
          // .json() on that throws something about tokens that helps nobody.
          const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
          if (!res.ok) {
            throw new Error(data?.error || `Transcription failed (HTTP ${res.status}).`);
          }
          const text = (data?.text ?? "").trim();
          if (!text) {
            setError("I didn't catch anything, sir — try again a little closer to the mic.");
            return;
          }
          onFinalRef.current(text, Math.round(performance.now() - transcribeStart));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsTranscribing(false);
        }
      };

      // Level metering doubles as silence detection and as the visible proof
      // that the microphone is picking something up.
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      const startedAt = performance.now();
      let hasSpoken = false;
      let quietSince: number | null = null;

      const tick = () => {
        if (recorderRef.current?.state !== "recording") return;
        analyser.getFloatTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) sumSquares += buffer[i] * buffer[i];
        const rms = Math.sqrt(sumSquares / buffer.length);
        setMicLevel(Math.min(1, rms * 8));

        const now = performance.now();
        if (rms > SPEECH_LEVEL) {
          hasSpoken = true;
          quietSince = null;
        } else if (rms < SILENCE_LEVEL) {
          quietSince ??= now;
        }

        const silentLongEnough =
          hasSpoken && quietSince !== null && now - quietSince > SILENCE_HANG_MS;
        const nothingSaid = !hasSpoken && now - startedAt > NO_SPEECH_TIMEOUT_MS;
        const tooLong = now - startedAt > MAX_RECORDING_MS;

        if (silentLongEnough || nothingSaid || tooLong) {
          recorderRef.current?.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      recorder.start();
      modeRef.current = "recording";
      setIsListening(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [teardownAudio]
  );

  const startSpeechApi = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError(
        "Voice input isn't supported in this browser, sir — add a Gemini or ElevenLabs API key in Settings, or use Chrome."
      );
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      setInterimTranscript(interim);
      if (final.trim()) onFinalRef.current(final.trim());
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
      recognitionRef.current = null;
      modeRef.current = null;
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setInterimTranscript("");
      const message = SPEECH_API_ERRORS[event.error];
      if (message) setError(message);
      else if (event.error) setError(`Voice input failed (${event.error}), sir.`);
    };

    recognitionRef.current = recognition;
    modeRef.current = "speech-api";
    recognition.start();
  }, []);

  const start = useCallback(async () => {
    if (isListening || isTranscribing) return;
    setError(null);
    setInterimTranscript("");

    const useRecording = canTranscribeRef.current && typeof MediaRecorder !== "undefined";

    // Ask for the microphone explicitly. This is what reliably triggers the
    // browser's permission prompt, and it tells us *why* when it fails —
    // SpeechRecognition on its own just dies quietly.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setError(micErrorMessage(err));
      return;
    }

    if (!useRecording) {
      // The speech API opens its own capture, so hand the device back first.
      stream.getTracks().forEach((track) => track.stop());
      startSpeechApi();
      return;
    }

    streamRef.current = stream;
    try {
      await startRecording(stream);
    } catch (err) {
      teardownAudio();
      setIsListening(false);
      setError(
        err instanceof Error
          ? `I couldn't start recording, sir: ${err.message}`
          : "I couldn't start recording, sir."
      );
    }
  }, [isListening, isTranscribing, startRecording, startSpeechApi, teardownAudio]);

  const stop = useCallback(() => {
    if (modeRef.current === "speech-api") {
      recognitionRef.current?.stop();
      return;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  return {
    supported: recorderAvailable || speechApiAvailable,
    mode: (canTranscribeOnServer && recorderAvailable
      ? "recording"
      : "speech-api") as VoiceInputMode,
    isListening,
    isTranscribing,
    interimTranscript,
    micLevel,
    error,
    start,
    stop,
    cancel,
  };
}
