import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult } from '../logic/types';
import type { AsrFixture } from '../logic/fixtures';
import { utteranceFromEvent } from '../logic/fixtures';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class FixtureAsrClient implements AsrClient {
  private listeners = new Map<EventName, Set<Listener>>();
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

  async stop() {
    this.started = false;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.emit('closed', new Error('stopped'));
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return { ok: true };
  }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
