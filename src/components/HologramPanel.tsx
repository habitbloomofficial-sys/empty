"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CloseIcon } from "./Icons";
import { buildHologramSource, type HologramSource } from "@/lib/depthMap";
import type { HologramMode, HologramSettings } from "./HologramScene";

const HologramScene = dynamic(() => import("./HologramScene"), { ssr: false });

const MODES: { id: HologramMode; label: string; hint: string }[] = [
  { id: "points", label: "Particles", hint: "Suspended motes of light" },
  { id: "surface", label: "Volume", hint: "Solid projected relief" },
  { id: "wire", label: "Lattice", hint: "Wireframe scan" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/60">
        {label}
        <span className="font-mono normal-case tracking-normal text-cyan-200/80">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-cyan-400/25 accent-cyan-300"
      />
    </label>
  );
}

export function HologramPanel({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<HologramSource | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [invert, setInvert] = useState(false);
  const [settings, setSettings] = useState<HologramSettings>({
    mode: "points",
    depthScale: 0.6,
    density: 150,
    opacity: 0.75,
    colorMix: 0.62,
    autoRotate: true,
  });

  // Drag-to-orbit, kept in refs so dragging never re-renders the scene tree.
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof HologramSettings>(key: K, value: HologramSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async (file: File, invertDepth: boolean) => {
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image, sir — a JPEG, PNG, or WebP will do.");
      return;
    }

    setBusy(true);
    setError(null);
    lastFileRef.current = file;

    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("I couldn't read that image, sir."));
        img.src = url;
      });

      setSource(buildHologramSource(image, { invert: invertDepth }));
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }, []);

  // Re-derive depth when the near/far guess is flipped.
  useEffect(() => {
    if (lastFileRef.current) void load(lastFileRef.current, invert);
    // Deliberately keyed on `invert` alone: `load` is stable and re-running on
    // a new file is already handled where the file is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invert]);

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file) void load(file, invert);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [load, invert]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-md sm:p-6"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 8 }}
        transition={{ type: "spring", damping: 26, stiffness: 240 }}
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-none border border-cyan-400/25 bg-slate-950/85 shadow-[0_0_80px_-12px_rgba(34,211,238,0.45)]"
      >
        <div className="flex items-center gap-3 border-b border-cyan-400/20 px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_10px_3px_rgba(34,211,238,0.6)]" />
          <h2 className="font-display text-sm font-semibold tracking-[0.3em] text-cyan-100">
            HOLOGRAM V3
          </h2>
          {fileName && (
            <span className="hidden max-w-[40%] truncate font-mono text-[10px] text-cyan-200/50 sm:block">
              {fileName}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-cyan-200/70 transition hover:bg-cyan-400/10 hover:text-cyan-100"
            aria-label="Close Hologram v3"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Projection stage */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void load(file, invert);
            }}
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              dragRef.current = { x: e.clientX, y: e.clientY };
              setYaw((v) => v + dx * 0.006);
              setPitch((v) => Math.max(-0.9, Math.min(0.9, v + dy * 0.005)));
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            className={`relative min-h-[280px] flex-1 cursor-grab touch-none select-none active:cursor-grabbing ${
              dragging ? "bg-cyan-400/10" : ""
            }`}
          >
            {/* Faint grid floor, sold entirely by CSS. */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.13]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(34,211,238,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.5) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
                maskImage: "radial-gradient(ellipse at center, black 20%, transparent 72%)",
                WebkitMaskImage: "radial-gradient(ellipse at center, black 20%, transparent 72%)",
              }}
            />

            <HologramScene source={source} settings={settings} yaw={yaw} pitch={pitch} />

            {!source && !busy && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <p className="font-display text-sm tracking-[0.2em] text-cyan-100/80">
                  NO SUBJECT LOADED
                </p>
                <p className="max-w-xs text-xs leading-relaxed text-cyan-200/50">
                  Drop a picture here, paste one, or use the button below. I&apos;ll read
                  its depth and project it.
                </p>
              </div>
            )}

            {busy && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="font-mono text-xs tracking-[0.25em] text-cyan-200 animate-pulse">
                  READING DEPTH…
                </p>
              </div>
            )}

            {dragging && (
              <div className="pointer-events-none absolute inset-3 rounded-none border-2 border-dashed border-cyan-300/70" />
            )}
          </div>

          {/* Controls */}
          <div className="w-full shrink-0 space-y-4 overflow-y-auto border-t border-cyan-400/20 bg-slate-950/60 p-5 lg:w-72 lg:border-l lg:border-t-0">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void load(file, invert);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full rounded-none border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-semibold tracking-wide text-cyan-100 transition hover:bg-cyan-400/20"
            >
              {source ? "Load another picture" : "Choose a picture"}
            </button>

            {error && (
              <p className="rounded-none bg-rose-500/15 px-3 py-2 text-[11px] text-rose-200">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/60">
                Projection
              </span>
              <div className="grid grid-cols-3 gap-1 rounded-none bg-cyan-400/10 p-1">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => update("mode", mode.id)}
                    title={mode.hint}
                    className={`rounded-md px-1 py-1.5 text-[11px] font-semibold transition ${
                      settings.mode === mode.id
                        ? "bg-cyan-400 text-slate-950"
                        : "text-cyan-100/70 hover:bg-cyan-400/15"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <Slider
              label="Depth"
              value={settings.depthScale}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => update("depthScale", v)}
            />
            <Slider
              label="Resolution"
              value={settings.density}
              min={40}
              max={400}
              step={4}
              onChange={(v) => update("density", v)}
              format={(v) => `${Math.round(v)}²`}
            />
            <Slider
              label="Glow"
              value={settings.opacity}
              min={0.15}
              max={1.6}
              step={0.01}
              onChange={(v) => update("opacity", v)}
            />
            <Slider
              label="True colour"
              value={settings.colorMix}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => update("colorMix", v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />

            <div className="space-y-2 border-t border-cyan-400/15 pt-3">
              {[
                {
                  label: "Spin",
                  value: settings.autoRotate,
                  toggle: () => update("autoRotate", !settings.autoRotate),
                },
                { label: "Invert depth", value: invert, toggle: () => setInvert((v) => !v) },
              ].map((row) => (
                <button
                  key={row.label}
                  onClick={row.toggle}
                  className="flex w-full items-center justify-between text-[11px] font-medium text-cyan-100/80"
                >
                  {row.label}
                  <span
                    className={`relative h-4 w-8 rounded-full transition ${
                      row.value ? "bg-cyan-400" : "bg-cyan-400/25"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-slate-950 transition-all ${
                        row.value ? "left-4" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>

            <p className="border-t border-cyan-400/15 pt-3 text-[10px] leading-relaxed text-cyan-200/40">
              Depth is estimated from the picture itself — light, colour, and
              composition — so it&apos;s an interpretation, not a measurement. Drag the
              projection to look around it.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
