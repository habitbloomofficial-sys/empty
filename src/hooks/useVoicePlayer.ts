"use client";

import { useCallback, useRef, useState } from "react";

export function useVoicePlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

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

  const speak = useCallback(
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

  return { speak, isSpeaking, audioLevel };
}
