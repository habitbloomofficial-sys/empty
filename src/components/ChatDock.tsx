"use client";

import { useState, type FormEvent } from "react";
import { EarIcon, MicIcon, SendIcon } from "./Icons";

export function ChatDock({
  onSend,
  disabled,
  isListening,
  isTranscribing,
  micSupported,
  micLevel,
  interimTranscript,
  handsFree,
  onToggleMic,
  wakeSupported,
  wakeEnabled,
  wakeListening,
  onToggleWake,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  isListening: boolean;
  isTranscribing: boolean;
  micSupported: boolean;
  micLevel: number;
  interimTranscript: string;
  /** The microphone is on and staying on between questions. */
  handsFree: boolean;
  onToggleMic: () => void;
  wakeSupported: boolean;
  wakeEnabled: boolean;
  wakeListening: boolean;
  onToggleWake: () => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  const inputValue = isListening
    ? interimTranscript ||
      (handsFree
        ? "Listening — just talk. I'll send when you pause."
        : "Listening… I'll send when you pause.")
    : isTranscribing
      ? "Transcribing…"
      : handsFree
        ? "Microphone on — say something whenever you like."
        : value;

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-strong mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full px-3 py-2 sm:px-4"
    >
      <button
        type="button"
        onClick={onToggleMic}
        disabled={!micSupported || isTranscribing}
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
          isListening
            ? "bg-sky-500 text-white"
            : handsFree
              ? "bg-sky-500/25 text-sky-700 ring-2 ring-sky-400/60"
              : "bg-sky-500/10 text-sky-600 hover:bg-sky-500/20"
        }`}
        aria-label={handsFree || isListening ? "Turn the microphone off" : "Turn the microphone on"}
        title={
          micSupported
            ? handsFree || isListening
              ? "Microphone is on and stays on — click to switch it off"
              : "Turn the microphone on and leave it on"
            : "Voice input not supported in this browser"
        }
      >
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full border-2 border-sky-400 animate-pulse-ring" />
            {/* Scales with your actual voice, so a dead mic is obvious at a glance. */}
            <span
              className="pointer-events-none absolute inset-0 rounded-full bg-sky-300/50 transition-transform duration-75"
              style={{ transform: `scale(${1 + Math.min(micLevel, 1) * 0.6})` }}
            />
          </>
        )}
        <MicIcon className="relative h-[18px] w-[18px]" />
      </button>

      {wakeSupported && (
        <button
          type="button"
          onClick={onToggleWake}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
            wakeEnabled
              ? "bg-sky-500/10 text-sky-600 hover:bg-sky-500/20"
              : "text-ink-700/30 hover:bg-slate-500/10"
          }`}
          aria-label={wakeEnabled ? "Stop listening for my name" : "Listen for my name"}
          title={
            wakeEnabled
              ? 'Listening for "Hey JARVIS" — click to switch off'
              : 'Click to listen for "Hey JARVIS"'
          }
        >
          {/* A quiet pulse while the listener is actually running. */}
          {wakeEnabled && wakeListening && (
            <span className="absolute inset-1 rounded-full bg-sky-400/20 animate-pulse" />
          )}
          <EarIcon className="relative h-[18px] w-[18px]" />
        </button>
      )}

      <input
        value={inputValue}
        onChange={(e) => setValue(e.target.value)}
        disabled={isListening || isTranscribing}
        placeholder="Ask JARVIS anything…"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-700/40 focus:outline-none disabled:italic"
      />

      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 disabled:opacity-30"
        aria-label="Send"
      >
        <SendIcon className="h-4 w-4" />
      </button>
    </form>
  );
}
