/** 'drop' silently discards chunks — used while Nono is speaking so the
 *  speaker's output doesn't loop back through the mic into either ASR
 *  or the Q&A session (feedback echo). */
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
    if (this.current === 'drop') return;
    this.sinks[this.current](chunk);
  }
}
