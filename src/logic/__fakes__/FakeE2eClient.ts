import type { E2eClient, E2eOpen, Unsubscribe } from '../adapters';
import type { TestResult, E2eError } from '../types';

type Ev = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class FakeE2eClient implements E2eClient {
  private listeners: Map<Ev, Set<(p: never) => void>> = new Map();
  private opened = false;
  public testResult: TestResult = { ok: true };
  public received: Uint8Array[] = [];

  async open(_opts: E2eOpen) {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  sendAudio(chunk: Uint8Array) {
    if (this.opened) this.received.push(chunk);
  }

  on(event: 'question_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'answer_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'audio', cb: (p: Uint8Array) => void): Unsubscribe;
  on(event: 'turn_end', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: E2eError) => void): Unsubscribe;
  // catch-all overload for union-typed calls (e.g. forEach over all events)
  on(event: Ev, cb: (p: unknown) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => {
      this.listeners.get(event)?.delete(cb);
    };
  }

  async testCredentials(
    _appId: string,
    _accessKey: string,
  ): Promise<import('../types').TestResult> {
    return this.testResult;
  }

  scriptTurn(t: { question: string; answer: string; audioChunks: Uint8Array[] }) {
    this.emit('question_transcript', { text: t.question });
    for (const chunk of t.audioChunks) this.emit('audio', chunk);
    this.emit('answer_transcript', { text: t.answer });
    this.emit('turn_end', undefined);
  }

  emitError(e: import('../types').E2eError): void {
    this.emit('error', e);
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
