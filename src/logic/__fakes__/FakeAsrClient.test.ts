import { describe, it, expect, vi } from 'vitest';
import { FakeAsrClient } from './FakeAsrClient';
import type { AsrError } from '../types';

describe('FakeAsrClient', () => {
  it('records sendAudio chunks for inspection', () => {
    const c = new FakeAsrClient();
    const a = new Uint8Array([1, 2, 3]);
    c.sendAudio(a);
    c.sendAudio(new Uint8Array([4]));
    expect(c.sentChunks.length).toBe(2);
    expect(c.sentChunks[0]).toEqual(a);
  });

  it('emits typed error with retryable flag', async () => {
    const c = new FakeAsrClient();
    await c.start({ lang: 'zh', enableSpeakerId: false });
    const spy = vi.fn();
    c.on('error', spy);
    const err: AsrError = { kind: 'network', message: 'drop', retryable: true };
    c.emitError(err);
    expect(spy).toHaveBeenCalledWith(err);
  });

  it('emits scripted finals', async () => {
    const c = new FakeAsrClient();
    await c.start({ lang: 'zh', enableSpeakerId: false });
    const seen: string[] = [];
    c.on('final', (u) => seen.push(u.text));
    c.scriptFinal({ t: 0, speaker: 'Speaker 1', text: 'hi', final: true });
    expect(seen).toEqual(['hi']);
  });
});
