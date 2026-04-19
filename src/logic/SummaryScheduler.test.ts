import { describe, it, expect, vi } from 'vitest';
import { SummaryScheduler } from './SummaryScheduler';
import { TranscriptBuffer } from './TranscriptBuffer';
import { FakeClock } from './__fakes__/FakeClock';
import { SUMMARY_INTERVAL_MS } from './config';
import type { Utterance, Summary } from './types';

const u = (t: number, text: string, final = true): Utterance => ({ t, speaker: 'S1', text, final });

const fakeLlmOk = async (_req: unknown) => ({
  text: JSON.stringify({ topic: 'Topic', text: 'Summary body', sameTopic: false }),
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('SummaryScheduler', () => {
  it('fires a summary after SUMMARY_INTERVAL_MS', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    buf.append(u(1000, 'alpha beta gamma'));
    const seen: Summary[] = [];
    const s = new SummaryScheduler({
      clock,
      buffer: buf,
      llm: { complete: fakeLlmOk } as never,
      onSummary: (x) => seen.push(x),
    });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(seen.length).toBe(1);
    expect(seen[0].topic).toBe('Topic');
  });

  it('skips the tick and retries next cycle if LLM fails', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    buf.append(u(1000, 'alpha'));
    let calls = 0;
    const llm = {
      complete: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return { text: JSON.stringify({ topic: 'T', text: 'S', sameTopic: false }) };
      }),
    };
    const seen: Summary[] = [];
    const s = new SummaryScheduler({
      clock,
      buffer: buf,
      llm: llm as never,
      onSummary: (x) => seen.push(x),
    });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(seen.length).toBe(1); // only the successful tick produced a card
  });

  it('does not fire if the buffer has no new text since last summary', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    const llm = { complete: vi.fn(fakeLlmOk) };
    const seen: Summary[] = [];
    const s = new SummaryScheduler({
      clock,
      buffer: buf,
      llm: llm as never,
      onSummary: (x) => seen.push(x),
    });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(seen).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
