import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { E2eClient, E2eOpen, Unsubscribe } from '../logic/adapters';
import type { TestResult, E2eError } from '../logic/types';

type Ev =
  | 'question_transcript'
  | 'answer_transcript'
  | 'audio'
  | 'turn_end'
  | 'user_speaking'
  | 'error';

export class DoubaoE2eClient implements E2eClient {
  private listeners = new Map<Ev, Set<(p: never) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(
    private sessionId: string,
    private appId: string,
    private accessKey: string,
  ) {}

  async open(opts: E2eOpen): Promise<void> {
    this.unlistens.push(
      await listen<{ text: string }>('e2e://question_transcript', (e) =>
        this.emit('question_transcript', e.payload),
      ),
    );
    this.unlistens.push(
      await listen<{ text: string }>('e2e://answer_transcript', (e) =>
        this.emit('answer_transcript', e.payload),
      ),
    );
    this.unlistens.push(
      await listen<number[]>('e2e://audio', (e) => this.emit('audio', new Uint8Array(e.payload))),
    );
    this.unlistens.push(await listen('e2e://turn_end', () => this.emit('turn_end', undefined)));
    this.unlistens.push(
      await listen('e2e://user_speaking', () => this.emit('user_speaking', undefined)),
    );
    this.unlistens.push(
      await listen<E2eError>('e2e://error', (e) => this.emit('error', e.payload)),
    );
    await invoke('e2e_open', {
      sessionId: this.sessionId,
      appId: this.appId,
      accessKey: this.accessKey,
      opts: {
        system_prompt: opts.systemPrompt,
        voice: opts.voice,
        dialog_id: opts.dialogId,
      },
    });
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('e2e_send_audio', { sessionId: this.sessionId, pcmChunk: Array.from(chunk) });
  }

  async close(): Promise<void> {
    try {
      await invoke('e2e_close', { sessionId: this.sessionId });
    } catch {
      /* ignore */
    }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: 'question_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'answer_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'audio', cb: (p: Uint8Array) => void): Unsubscribe;
  on(event: 'turn_end', cb: () => void): Unsubscribe;
  on(event: 'user_speaking', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: E2eError) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('e2e_test_credentials', { appId, accessKey });
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
