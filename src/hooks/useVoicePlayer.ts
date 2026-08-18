"use client";

import { useCallback, useRef, useState } from "react";

// JARVIS speaks through ElevenLabs when it can, and through the voice built
// into the operating system when it can't. A refused ElevenLabs key shouldn't
// leave him mute — a slightly less characterful voice beats silence.

function pickBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  // Aim for a British male voice for the butler register, then settle.
  return (
    voices.find((v) => /en[-_]GB/i.test(v.lang) && /george|ryan|daniel|male/i.test(v.name)) ??
    voices.find((v) => /en[-_]GB/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang) && /david|guy|male/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang))
  );
}

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return existing;

  // Chrome populates the list asynchronously on first use.
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timeout);
        resolve(window.speechSynthesis.getVoices());
      },
      { once: true }
    );
  });
}

export function useVoicePlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const ensureContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  const speakWithElevenLabs = useCallback(
    async (text: string, voiceId?: string) => {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "TTS failed" }));
        throw new Error(body.error || "TTS failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const ctx = ensureContext();
      if (ctx.state === "suspended") await ctx.resume();

      const audio = new Audio(url);
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;

      setIsSpeaking(true);

      function tick() {
        const bins = analyserRef.current;
        if (!bins) return;
        const data = new Uint8Array(bins.frequencyBinCount);
        bins.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setAudioLevel(Math.min(1, sum / data.length / 160));
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);

      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      analyser.disconnect();
      analyserRef.current = null;
      setIsSpeaking(false);
      setAudioLevel(0);
      URL.revokeObjectURL(url);
    },
    [ensureContext]
  );

  const speakWithBrowser = useCallback(async (text: string): Promise<boolean> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;

    const voices = await loadVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickBrowserVoice(voices);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 0.95;

    setIsSpeaking(true);
    // There's no audio graph to analyse here, so give the orb a gentle,
    // speech-like pulse rather than leaving it frozen.
    const startedAt = performance.now();
    const pulse = () => {
      const t = (performance.now() - startedAt) / 1000;
      setAudioLevel(0.35 + 0.25 * Math.sin(t * 11) + 0.1 * Math.sin(t * 27));
      rafRef.current = requestAnimationFrame(pulse);
    };
    rafRef.current = requestAnimationFrame(pulse);

    const spoke = await new Promise<boolean>((resolve) => {
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsSpeaking(false);
    setAudioLevel(0);
    return spoke;
  }, []);

  const speak = useCallback(
    async (text: string, voiceId?: string) => {
      try {
        await speakWithElevenLabs(text, voiceId);
        setFallbackNotice(null);
      } catch (err) {
        // Clean up anything the failed attempt left running before falling back.
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        analyserRef.current = null;
        setIsSpeaking(false);
        setAudioLevel(0);

        const reason = err instanceof Error ? err.message : String(err);
        const spoke = await speakWithBrowser(text);
        if (!spoke) throw err;
        setFallbackNotice(`Speaking with the browser's built-in voice — ${reason}`);
      }
    },
    [speakWithElevenLabs, speakWithBrowser]
  );

  return { speak, isSpeaking, audioLevel, fallbackNotice };
}
