import type { AsrClient, AsrOpts, Unsubscribe } from '../adapters';
import type { Utterance, TestResult } from '../types';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class FakeAsrClient implements AsrClient {
  private started = false;
  private listeners: Map<EventName, Set<Listener>> = new Map();
  public testResult: TestResult = { ok: true };

  async start(_opts: AsrOpts): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.emit('closed', new Error('stopped'));
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return this.testResult;
  }

  emitFinal(t: number, speaker: string, text: string) {
    if (!this.started) return;
    this.emit('final', { t, speaker, text, final: true });
  }

  emitPartial(t: number, speaker: string, text: string) {
    if (!this.started) return;
    this.emit('partial', { t, speaker, text, final: false });
  }

  emitError(e: Error) {
    this.emit('error', e);
  }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
