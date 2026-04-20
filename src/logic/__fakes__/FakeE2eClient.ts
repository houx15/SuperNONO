import type { E2eClient, E2eOpen, Unsubscribe } from '../adapters';
import type { TestResult } from '../types';

type EventName = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class FakeE2eClient implements E2eClient {
  private listeners: Map<EventName, Set<(p: unknown) => void>> = new Map();
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

  on(event: EventName, cb: (p: unknown) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
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
    this.emit('turn_end', {});
  }

  emitError(e: import('../types').E2eError): void {
    this.emit('error', e);
  }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
