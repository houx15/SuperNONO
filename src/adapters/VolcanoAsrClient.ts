import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult } from '../logic/types';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class VolcanoAsrClient implements AsrClient {
  private sessionId: string;
  private listeners = new Map<EventName, Set<Listener>>();
  private unlistens: UnlistenFn[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async start(opts: AsrOpts): Promise<void> {
    this.unlistens.push(
      await listen<Utterance>('asr://partial', (e) => this.emit('partial', e.payload)),
    );
    this.unlistens.push(
      await listen<Utterance>('asr://final', (e) => this.emit('final', e.payload)),
    );
    this.unlistens.push(
      await listen<string>('asr://error', (e) => this.emit('error', new Error(e.payload))),
    );
    this.unlistens.push(
      await listen<string>('asr://closed', () => this.emit('closed', new Error('closed'))),
    );

    await invoke('asr_start', {
      sessionId: this.sessionId,
      appId: '<stub>',
      accessKey: '<stub>',
      params: { lang: opts.lang, enable_speaker_id: opts.enableSpeakerId },
    });
  }

  async stop(): Promise<void> {
    try {
      await invoke('asr_stop', { sessionId: this.sessionId });
    } catch {
      /* stub errors expected until M2 */
    }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('asr_test_credentials', { appId, accessKey });
  }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
