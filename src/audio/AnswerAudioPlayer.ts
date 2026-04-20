const SAMPLE_RATE = 24000;

export class AnswerAudioPlayer {
  private nextStart: number;
  private stopped = false;
  constructor(private ctx: AudioContext) {
    this.nextStart = ctx.currentTime;
  }

  enqueue(chunk: Uint8Array): void {
    if (this.stopped) return;
    // Expect 32-bit float LE (pcm, single channel, 24000 Hz).
    const float = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4);
    const buffer = this.ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.nextStart, this.ctx.currentTime);
    source.start(startAt);
    this.nextStart = startAt + float.length / SAMPLE_RATE;
  }

  stop(): void {
    this.stopped = true;
  }
}
