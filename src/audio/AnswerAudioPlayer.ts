const SAMPLE_RATE = 24000;

/**
 * Plays back Doubao E2E TTS audio chunks as they arrive.
 *
 * Expects `pcm_s16le` format: 16-bit signed little-endian PCM, mono, 24 kHz
 * (configured in the Rust StartSession payload). We convert each chunk to
 * Float32 for Web Audio and schedule it immediately after the previous one
 * so playback is seamless across chunk boundaries.
 */
export class AnswerAudioPlayer {
  private nextStart: number;
  private stopped = false;
  constructor(private ctx: AudioContext) {
    this.nextStart = ctx.currentTime;
  }

  enqueue(chunk: Uint8Array): void {
    if (this.stopped) return;
    if (chunk.byteLength < 2) return;

    // Ensure even length (s16le = 2 bytes/sample). Trailing odd byte dropped.
    const sampleCount = Math.floor(chunk.byteLength / 2);
    // Copy into an aligned buffer — the incoming Uint8Array may have been
    // built from a Tauri event payload (number[]) whose underlying buffer
    // isn't guaranteed to be 2-byte aligned.
    const aligned = new ArrayBuffer(sampleCount * 2);
    new Uint8Array(aligned).set(chunk.subarray(0, sampleCount * 2));
    const int16 = new Int16Array(aligned);

    const float = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float[i] = int16[i] / 32768;
    }

    const buffer = this.ctx.createBuffer(1, sampleCount, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // Schedule back-to-back. If we've fallen behind the audio clock (e.g.
    // first chunk arrived late), clamp to currentTime so we don't try to
    // start in the past (which causes pops).
    const startAt = Math.max(this.nextStart, this.ctx.currentTime);
    source.start(startAt);
    this.nextStart = startAt + sampleCount / SAMPLE_RATE;
  }

  stop(): void {
    this.stopped = true;
  }
}
