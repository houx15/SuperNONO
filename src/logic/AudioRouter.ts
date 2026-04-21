/** 'drop' silently discards chunks — used while Nono is speaking so the
 *  speaker's output doesn't loop back through the mic into the Q&A
 *  session (feedback echo). ASR still receives silence frames in this
 *  mode — see `feed()`. */
export type Sink = 'asr' | 'e2e' | 'drop';

export interface AudioRouterSinks {
  asr: (chunk: Uint8Array) => void;
  e2e: (chunk: Uint8Array) => void;
}

export class AudioRouter {
  private current: Sink = 'asr';
  constructor(private sinks: AudioRouterSinks) {}

  get active(): Sink {
    return this.current;
  }

  switchTo(next: Sink): void {
    this.current = next;
  }

  feed(chunk: Uint8Array): void {
    if (this.current === 'asr') {
      this.sinks.asr(chunk);
      return;
    }
    // Non-ASR modes: send real audio to whichever downstream owns the
    // moment (e2e for Q&A, nobody for 'drop' while Nono speaks), AND
    // send an equal-size silence chunk to ASR so its WebSocket keeps
    // receiving traffic. Volcano SAUC closes the stream after ~30 s of
    // inactivity, which would otherwise kick off a reconnect loop the
    // instant any Q&A runs long. Zero-filled Uint8Arrays transcribe
    // to nothing on Volcano's side so this is cheap and safe.
    this.sinks.asr(new Uint8Array(chunk.byteLength));
    if (this.current === 'e2e') {
      this.sinks.e2e(chunk);
    }
  }
}
