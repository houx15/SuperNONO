import { describe, it, expect } from 'vitest';
import { FakeE2eClient } from './FakeE2eClient';
import type { E2eError } from '../types';

describe('FakeE2eClient', () => {
  it('scripts a full turn', async () => {
    const c = new FakeE2eClient();
    const events: Array<[string, unknown]> = [];
    (['question_transcript', 'answer_transcript', 'audio', 'turn_end', 'error'] as const).forEach(
      (e) => c.on(e, (p) => events.push([e, p])),
    );
    await c.open({ systemPrompt: 'x', voice: 'vv' });
    c.scriptTurn({
      question: '价格多少?',
      answer: '新加坡市场落在 12-28 美元',
      audioChunks: [new Uint8Array([1, 2, 3])],
    });
    await Promise.resolve();
    const kinds = events.map(([k]) => k);
    expect(kinds).toContain('question_transcript');
    expect(kinds).toContain('answer_transcript');
    expect(kinds).toContain('audio');
    expect(kinds[kinds.length - 1]).toBe('turn_end');
  });
});

it('emits typed error', async () => {
  const c = new FakeE2eClient();
  await c.open({ systemPrompt: 'p', voice: 'v' });
  const seen: E2eError[] = [];
  c.on('error', (e) => seen.push(e as E2eError));
  const err: E2eError = { kind: 'server', message: 'boom', retryable: true };
  c.emitError(err);
  expect(seen).toEqual([err]);
});
