import type { AsrClient, AsrOpts, Unsubscribe } from '../adapters';
import type { Utterance, AsrError, TestResult } from '../types';

export class FakeAsrClient implements AsrClient {
  public sentChunks: Uint8Array[] = [];
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  async start(_opts: AsrOpts): Promise<void> {}
  async stop(): Promise<void> {}

  sendAudio(chunk: Uint8Array): void {
    this.sentChunks.push(chunk);
  }

  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (p: any) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return { ok: true };
  }

  scriptPartial(u: Utterance): void {
    this.emit('partial', u);
  }
  scriptFinal(u: Utterance): void {
    this.emit('final', u);
  }
  emitError(e: AsrError): void {
    this.emit('error', e);
  }
  emitClosed(): void {
    this.emit('closed', undefined);
  }

  private emit(event: string, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
