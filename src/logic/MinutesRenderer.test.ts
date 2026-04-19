import { describe, it, expect } from 'vitest';
import { MinutesRenderer } from './MinutesRenderer';
import type { Summary, Utterance, MeetingMeta } from './types';

const fakeLlm = {
  complete: async (_req: { prompt: string }) => ({
    text: JSON.stringify({
      decisions: ['decision A', 'decision B'],
      actions: [{ owner: 'S1', task: 'do the thing', tag: 'Ops' }],
    }),
  }),
};

describe('MinutesRenderer', () => {
  it('returns a markdown document with required sections', async () => {
    const meta: MeetingMeta = {
      schema_version: 1,
      id: 'mtg_test1234',
      title: 'Test',
      started_at: 0,
      ended_at: 3600_000,
      duration_sec: 3600,
      speaker_count: 2,
      tag: 'General',
      active_summary_index: -1,
    };
    const summaries: Summary[] = [
      {
        time: '00:00 — 00:05',
        topic: 'Intro',
        text: '...',
        speakers: null,
        state: 'done',
        startedAt: 0,
        endedAt: 300_000,
      },
    ];
    const tr: Utterance[] = [{ t: 100, speaker: 'S1', text: 'hello', final: true }];
    const md = await new MinutesRenderer(fakeLlm).render({ meta, summaries, transcript: tr });
    expect(md).toContain('# Test');
    expect(md).toContain('## Agenda');
    expect(md).toContain('Intro');
    expect(md).toContain('## Key decisions');
    expect(md).toContain('decision A');
    expect(md).toContain('## Action items');
    expect(md).toContain('do the thing');
    expect(md).toContain('## Full transcript');
    expect(md).toContain('hello');
  });

  it('falls back gracefully when LLM errors', async () => {
    const brokenLlm = {
      complete: async () => {
        throw new Error('x');
      },
    };
    const meta: MeetingMeta = {
      schema_version: 1,
      id: 'x',
      title: 'T',
      started_at: 0,
      ended_at: 1,
      duration_sec: 0,
      speaker_count: 0,
      tag: 'General',
      active_summary_index: -1,
    };
    const md = await new MinutesRenderer(brokenLlm).render({ meta, summaries: [], transcript: [] });
    expect(md).toContain('## Key decisions');
    expect(md).toContain('(minutes generation unavailable'); // graceful line
  });
});
