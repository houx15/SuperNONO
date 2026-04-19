import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { E2eClient, E2eOpen, Unsubscribe } from '../logic/adapters';
import type { TestResult } from '../logic/types';

type EventName = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class DoubaoE2eClient implements E2eClient {
  private listeners = new Map<EventName, Set<(p: unknown) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(private sessionId: string) {}

  async open(opts: E2eOpen): Promise<void> {
    this.unlistens.push(
      await listen('e2e://question_transcript', (e) => this.emit('question_transcript', e.payload)),
    );
    this.unlistens.push(
      await listen('e2e://answer_transcript', (e) => this.emit('answer_transcript', e.payload)),
    );
    this.unlistens.push(await listen('e2e://audio', (e) => this.emit('audio', e.payload)));
    this.unlistens.push(await listen('e2e://turn_end', () => this.emit('turn_end', {})));
    this.unlistens.push(
      await listen<string>('e2e://error', (e) => this.emit('error', new Error(e.payload))),
    );

    await invoke('e2e_open', {
      sessionId: this.sessionId,
      token: '<stub>',
      opts: { system_prompt: opts.systemPrompt, voice: opts.voice },
    });
  }

  async close(): Promise<void> {
    try {
      await invoke('e2e_close', { sessionId: this.sessionId });
    } catch {
      /* stub errors expected until M2 */
    }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('e2e_send_audio', {
      sessionId: this.sessionId,
      pcmChunk: Array.from(chunk),
    });
  }

  on(event: EventName, cb: (p: unknown) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(apiKey: string): Promise<TestResult> {
    return await invoke<TestResult>('e2e_test_credentials', { apiKey });
  }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
