import type { MicCaptureHandle, Unsubscribe } from '../adapters';

type Ev = 'chunk' | 'rms' | 'error';

export class FakeMicCapture implements MicCaptureHandle {
  private running = false;
  private listeners = new Map<Ev, Set<(p: never) => void>>();

  async start(): Promise<void> {
    this.running = true;
  }
  async stop(): Promise<void> {
    this.running = false;
  }

  on(event: 'chunk', cb: (c: Uint8Array) => void): Unsubscribe;
  on(event: 'rms', cb: (r: number) => void): Unsubscribe;
  on(event: 'error', cb: (e: Error) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  scriptChunk(c: Uint8Array): void {
    if (this.running) this.emit('chunk', c);
  }
  scriptRms(r: number): void {
    if (this.running) this.emit('rms', r);
  }
  scriptError(e: Error): void {
    if (this.running) this.emit('error', e);
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
