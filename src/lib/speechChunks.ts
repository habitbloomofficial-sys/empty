// Speech has to start before the sentence is finished being written, or the
// wait for the last word of a reply is a wait for the first sound of it.
// Text arrives from the model a few characters at a time; this cuts it into
// the largest pieces that still sound natural spoken on their own, and hands
// each one off as soon as it's complete.

/** Below this, a chunk is too short to sound like anything but a fragment. */
const MIN_CHUNK = 45;
/** Above this, stop waiting for punctuation and break at a word boundary. */
const MAX_CHUNK = 240;

const SENTENCE_END = /[.!?…](["')\]]*)(\s|$)/g;

export class SpeechChunker {
  private buffer = "";

  /** Feed a delta; returns any chunks that are now ready to be spoken. */
  push(delta: string): string[] {
    this.buffer += delta;
    const ready: string[] = [];

    for (;;) {
      const cut = this.findCut();
      if (cut === null) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (chunk) ready.push(chunk);
    }

    return ready;
  }

  /** Whatever is left at the end of the reply. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest || null;
  }

  private findCut(): number | null {
    if (this.buffer.length < MIN_CHUNK) return null;

    // Prefer a sentence boundary at or after the minimum length.
    SENTENCE_END.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
      const end = match.index + match[0].length;
      if (end >= MIN_CHUNK) return end;
    }

    // A paragraph break is just as good a place to breathe.
    const newline = this.buffer.indexOf("\n", MIN_CHUNK);
    if (newline !== -1) return newline + 1;

    // Nothing punctuated in a long run of text — break at the last space
    // rather than let the first chunk grow without bound.
    if (this.buffer.length >= MAX_CHUNK) {
      const space = this.buffer.lastIndexOf(" ", MAX_CHUNK);
      return space > MIN_CHUNK ? space + 1 : MAX_CHUNK;
    }

    return null;
  }
}
