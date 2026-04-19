import { describe, it, expect } from 'vitest';
import { FakeAsrClient } from './FakeAsrClient';
import type { Utterance } from '../types';

describe('FakeAsrClient', () => {
  it('fires subscribed final events in order', async () => {
    const asr = new FakeAsrClient();
    const seen: string[] = [];
    asr.on('final', (u) => seen.push((u as Utterance).text));
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    asr.emitFinal(1000, 'S1', 'hello');
    asr.emitFinal(2000, 'S2', 'world');
    expect(seen).toEqual(['hello', 'world']);
  });

  it('only fires events after start()', async () => {
    const asr = new FakeAsrClient();
    const seen: unknown[] = [];
    asr.on('final', (u) => seen.push(u));
    asr.emitFinal(1, 'S1', 'dropped');
    expect(seen).toEqual([]);
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    asr.emitFinal(2, 'S1', 'kept');
    expect(seen.length).toBe(1);
  });

  it('testCredentials returns ok by default', async () => {
    const asr = new FakeAsrClient();
    expect(await asr.testCredentials('id', 'key')).toEqual({ ok: true });
  });
});
