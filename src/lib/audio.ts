// MediaRecorder gives us whatever the browser feels like producing — usually
// WebM/Opus, sometimes MP4. Transcription services don't all accept those
// (Gemini in particular wants WAV/MP3/OGG/FLAC), so we decode in the browser
// and hand the server plain 16 kHz mono WAV, which every service takes.

const TARGET_SAMPLE_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decode a recording and re-encode it as mono 16 kHz WAV. Returns null if the
 * browser can't decode it, so the caller can fall back to the original blob.
 */
export async function toMonoWav(recording: Blob): Promise<Blob | null> {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    const ctx = new Ctor();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await recording.arrayBuffer());
    } finally {
      void ctx.close().catch(() => {
        /* already closed */
      });
    }

    if (!decoded.duration) return null;

    // Rendering through an OfflineAudioContext handles both the downmix to
    // mono and the resample to 16 kHz in one pass.
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
  } catch {
    return null;
  }
}
