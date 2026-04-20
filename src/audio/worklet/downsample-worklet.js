// Downsamples 48kHz Float32 → 16kHz Int16 LE.
// Posts 200ms chunks (3200 samples @16kHz = 6400 bytes) on 'chunk'.
// Posts RMS (0..1) every ~50ms on 'rms'.
// Assumes input sample rate is 48000 Hz (standard browser default).

class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Decimation factor 3 (48000 → 16000). Simple pick-every-third-sample.
    // For 16kHz ASR this is acceptable — the anti-alias filter in the
    // browser's audio path already attenuates above ~20kHz and Volcano
    // tolerates minor aliasing from a 24kHz Nyquist source.
    this.decim = 3;
    this.sampleIdx = 0;
    this.chunkBuf = new Int16Array(3200); // 200ms @ 16kHz
    this.chunkWriteIdx = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
    this.rmsWindowSamples = 800; // 50ms @ 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      if (this.sampleIdx % this.decim === 0) {
        const f = Math.max(-1, Math.min(1, ch[i]));
        const s16 = f < 0 ? Math.round(f * 0x8000) : Math.round(f * 0x7fff);
        this.chunkBuf[this.chunkWriteIdx++] = s16;
        this.rmsSum += f * f;
        this.rmsCount++;

        if (this.rmsCount >= this.rmsWindowSamples) {
          const rms = Math.sqrt(this.rmsSum / this.rmsCount);
          this.port.postMessage({ type: 'rms', value: rms });
          this.rmsSum = 0;
          this.rmsCount = 0;
        }

        if (this.chunkWriteIdx >= this.chunkBuf.length) {
          // Copy to a fresh ArrayBuffer so we can transfer ownership.
          const out = new Int16Array(this.chunkBuf.length);
          out.set(this.chunkBuf);
          this.port.postMessage(
            { type: 'chunk', buffer: out.buffer },
            [out.buffer],
          );
          this.chunkWriteIdx = 0;
        }
      }
      this.sampleIdx++;
    }
    return true;
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
