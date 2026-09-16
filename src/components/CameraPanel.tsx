"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon } from "./Icons";
import { describeClientFetchError, postJson } from "@/lib/clientFetch";

// The webcam, opened on purpose and closed properly.
//
// The single most important line in this file is the one that stops every
// track when the panel closes. A getUserMedia stream left running keeps the
// camera light on after the window has gone, which is both a real privacy
// problem and the thing that makes people tape over the lens — so it is done
// in a cleanup that runs on every exit path, not just the tidy one.
//
// The preview is live because you cannot aim a camera you cannot see. Only the
// still captured when he presses the button ever leaves the browser.

interface Props {
  open: boolean;
  onClose: () => void;
  /** Filled in when Jarvis asked to look, rather than the button being pressed. */
  question?: string;
  /** Hands the answer back so it can go into the conversation. */
  onSaw?: (question: string, answer: string) => void;
}

export function CameraPanel({ open, onClose, question, onSaw }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  // Initialised from the prop rather than synced to it in an effect: the
  // parent gives this panel a `key` that changes whenever it is opened afresh,
  // so React remounts it and the question arrives as initial state. Syncing it
  // in an effect instead means a second render on every open, which is the
  // cascading-render pattern React now warns about.
  const [ask, setAsk] = useState(question ?? "");

  /** Let go of the camera. Called from every path that ends the panel. */
  const release = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      release();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        // Device labels are blank until permission has been granted once, so
        // the list is only worth reading after the stream is up.
        const found = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(found.filter((d) => d.kind === "videoinput"));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "The browser is blocking the camera. Click the camera icon in the address bar and allow it, then reopen this."
            : name === "NotFoundError"
              ? "No camera found on this computer."
              : name === "NotReadableError"
                ? "Something else is using the camera — close Teams, Zoom or the Camera app and try again."
                : "Couldn't start the camera."
        );
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [open, deviceId, release]);

  // Closing the window or switching tab should not leave it running either.
  useEffect(() => {
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [release]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("The picture hasn't started yet — give it a second.");
      return;
    }

    // Scaled down before sending: a 4K frame is slower and no more accurate.
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Couldn't read the picture from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

    setAsking(true);
    setAnswer(null);
    setError(null);
    try {
      const asked = ask.trim();
      const result = await postJson<{ answer?: string; error?: string }>("/api/see", {
        image: dataUrl,
        mediaType: "image/jpeg",
        question: asked || undefined,
      });
      if (result.error) setError(result.error);
      else if (result.answer) {
        setAnswer(result.answer);
        onSaw?.(asked || "What can you see?", result.answer);
      }
    } catch (err) {
      setError(describeClientFetchError(err));
    } finally {
      setAsking(false);
    }
  }, [ask, onSaw]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="glass w-full max-w-2xl rounded-none p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-cream">Through the camera</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-sand-500 hover:bg-white/[0.06]"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-none bg-black">
          {/* muted + playsInline, or iOS refuses to play it at all. */}
          <video ref={videoRef} muted playsInline className="max-h-[46vh] w-full object-contain" />
        </div>

        {devices.length > 1 && (
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="mt-2 w-full rounded-none bg-black/30 px-2 py-1.5 text-xs text-cream"
          >
            <option value="">Default camera</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        )}

        <input
          value={ask}
          onChange={(event) => setAsk(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !asking) void capture();
          }}
          placeholder="What should I look for? (or leave it blank)"
          className="mt-2 w-full rounded-none bg-black/30 px-3 py-2 text-xs text-cream placeholder:text-sand-600"
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void capture()}
            disabled={asking}
            className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {asking ? "Looking…" : "Take a look"}
          </button>
          <span className="text-[10px] text-sand-600">
            One still is sent to the model to be described. Nothing is recorded or saved.
          </span>
        </div>

        {error && (
          <p className="mt-2 rounded-none bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
        {answer && <p className="mt-2 text-xs leading-relaxed text-cream">{answer}</p>}
      </div>
    </div>
  );
}
