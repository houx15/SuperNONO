import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult, AsrError } from '../logic/types';
import type { AsrFixture } from '../logic/fixtures';
import { utteranceFromEvent } from '../logic/fixtures';

type Ev = 'partial' | 'final' | 'error' | 'closed';

export class FixtureAsrClient implements AsrClient {
  private listeners = new Map<Ev, Set<(p: never) => void>>();
  private started = false;
  private timers: number[] = [];

  constructor(
    private fixture: AsrFixture,
    private speedFactor = 1,
  ) {}

  async start(_opts: AsrOpts) {
    if (this.started) return;
    this.started = true;
    const base = Date.now();
    this.fixture.events.forEach((e) => {
      const delay = e.atMs / this.speedFactor;
      const id = window.setTimeout(() => {
        if (!this.started) return;
        this.emit('final', utteranceFromEvent(e, base));
      }, delay);
      this.timers.push(id);
    });
  }

  sendAudio(_chunk: Uint8Array): void {
    // fixture: no-op; audio is scripted via events
  }

  async stop() {
    this.started = false;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.emit('closed', undefined);
  }

  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => {
      this.listeners.get(event)?.delete(cb);
    };
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return { ok: true };
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
