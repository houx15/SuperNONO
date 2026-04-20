import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult, AsrError } from '../logic/types';

type Ev = 'partial' | 'final' | 'error' | 'closed';

export class VolcanoAsrClient implements AsrClient {
  private listeners = new Map<Ev, Set<(p: never) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(
    private sessionId: string,
    private appId: string,
    private accessKey: string,
  ) {}

  async start(opts: AsrOpts): Promise<void> {
    this.unlistens.push(
      await listen<Utterance>('asr://partial', (e) => this.emit('partial', e.payload)),
    );
    this.unlistens.push(
      await listen<Utterance>('asr://final', (e) => this.emit('final', e.payload)),
    );
    this.unlistens.push(
      await listen<AsrError>('asr://error', (e) => this.emit('error', e.payload)),
    );
    this.unlistens.push(await listen('asr://closed', () => this.emit('closed', undefined)));
    await invoke('asr_start', {
      sessionId: this.sessionId,
      appId: this.appId,
      accessKey: this.accessKey,
      params: { lang: opts.lang, enableSpeakerId: opts.enableSpeakerId },
    });
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('asr_send_audio', { sessionId: this.sessionId, pcmChunk: Array.from(chunk) });
  }

  async stop(): Promise<void> {
    try {
      await invoke('asr_stop', { sessionId: this.sessionId });
    } catch {
      /* ignore */
    }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('asr_test_credentials', { appId, accessKey });
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
