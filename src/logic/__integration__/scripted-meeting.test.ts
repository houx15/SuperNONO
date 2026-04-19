import { describe, it, expect } from 'vitest';
import { MeetingSession } from '../MeetingSession';
import { FakeAsrClient } from '../__fakes__/FakeAsrClient';
import { FakeE2eClient } from '../__fakes__/FakeE2eClient';
import { FakeLlmClient } from '../__fakes__/FakeLlmClient';
import { InMemoryPersistence } from '../__fakes__/InMemoryPersistence';
import { FakeClock } from '../__fakes__/FakeClock';
import { DEFAULT_WAKE_WORD } from '../config';

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('integration: scripted 15-min meeting', () => {
  it('produces summaries, 1 Q&A exchange, and a non-empty minutes doc', async () => {
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const llm = new FakeLlmClient([
      {
        match: (p) => p.includes('summarising'),
        text: JSON.stringify({ topic: 'Topic', text: 'Summary sentence.', sameTopic: false }),
      },
      {
        match: (p) => p.includes('extracting'),
        text: JSON.stringify({
          decisions: ['D1'],
          actions: [{ owner: 'S1', task: 'Do X', tag: 'Ops' }],
        }),
      },
      { match: () => true, text: '{"topic":"T","text":"","sameTopic":true}' },
    ]);
    const persistence = new InMemoryPersistence();
    const clock = new FakeClock(1_700_000_000_000);
    const session = new MeetingSession({
      asr,
      e2e,
      llm,
      persistence,
      clock,
      config: { wakeWord: DEFAULT_WAKE_WORD, lang: 'zh' },
    });

    const summaryEvents: unknown[] = [];
    const qaEvents: unknown[] = [];
    session.on('summary', (s) => summaryEvents.push(s));
    session.on('qa', (x) => qaEvents.push(x));

    await session.start('Scripted meeting');

    // Scripted chatter: 30 utterances spaced 20s apart spans 10 minutes of clock.
    // That's 2 full summary intervals → at least 2 summary cards.
    for (let i = 0; i < 30; i++) {
      asr.emitFinal(clock.now(), `Speaker ${(i % 3) + 1}`, `Utterance number ${i}.`);
      clock.advance(20_000);
      await flush();
    }

    // Wake word fires, E2E drives the Q&A
    asr.emitFinal(clock.now(), 'Speaker 1', '嘿 Nono, summarise pricing.');
    await flush();
    e2e.scriptTurn({
      question: 'summarise pricing?',
      answer: 'Pricing summary.',
      audioChunks: [new Uint8Array([1, 2])],
    });
    await flush();

    await session.stop();

    const full = await persistence.readMeeting(session.id!);
    expect(summaryEvents.length).toBeGreaterThanOrEqual(2);
    expect(qaEvents.length).toBe(1);
    expect(full.minutesMd).toContain('# Scripted meeting');
    expect(full.minutesMd).toContain('D1');
    expect(full.meta.ended_at).not.toBeNull();
  });
});
