export type Sink = 'asr' | 'e2e';

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
    this.sinks[this.current](chunk);
  }
}
