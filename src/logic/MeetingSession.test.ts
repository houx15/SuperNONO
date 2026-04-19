import { describe, it, expect } from 'vitest';
import { MeetingSession } from './MeetingSession';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeLlmClient } from './__fakes__/FakeLlmClient';
import { InMemoryPersistence } from './__fakes__/InMemoryPersistence';
import { FakeClock } from './__fakes__/FakeClock';
import { SUMMARY_INTERVAL_MS, DEFAULT_WAKE_WORD } from './config';
import type { Summary } from './types';

function makeSession() {
  const asr = new FakeAsrClient();
  const e2e = new FakeE2eClient();
  const llm = new FakeLlmClient([
    {
      match: (p) => p.includes('summarising'),
      text: JSON.stringify({ topic: 'T', text: 'body', sameTopic: false }),
    },
    {
      match: (p) => p.includes('extracting meeting decisions'),
      text: JSON.stringify({ decisions: [], actions: [] }),
    },
    { match: () => true, text: JSON.stringify({ topic: 'T', text: 'default', sameTopic: false }) },
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
  return { session, asr, e2e, llm, persistence, clock };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('MeetingSession', () => {
  it('emits transcript events and persists utterances', async () => {
    const { session, asr, persistence } = makeSession();
    const transcripts: unknown[] = [];
    session.on('transcript', (u) => transcripts.push(u));
    await session.start('Test meeting');
    asr.emitFinal(1, 'S1', 'hello world');
    await flush();
    expect(transcripts.length).toBe(1);
    const full = await persistence.readMeeting(session.id!);
    expect(full.transcript.map((u) => u.text)).toEqual(['hello world']);
  });

  it('produces a summary after SUMMARY_INTERVAL_MS', async () => {
    const { session, asr, clock } = makeSession();
    const summaries: Summary[] = [];
    session.on('summary', (s) => summaries.push(s as Summary));
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', 'lots of content to summarise');
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(summaries.length).toBe(1);
  });

  it('triggers Q&A when wake word is heard', async () => {
    const { session, asr, e2e } = makeSession();
    const orbStates: string[] = [];
    session.on('orbState', (s) => orbStates.push(s as string));
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', '嘿 Nono, 查价格');
    // Flush so MeetingSession routes utterance to wake-word matcher and triggers QaHandoff,
    // which asynchronously opens E2E. Then script the E2E turn.
    await flush();
    e2e.scriptTurn({ question: '价格?', answer: '12-28 USD', audioChunks: [new Uint8Array([1])] });
    await flush();
    expect(orbStates).toEqual(expect.arrayContaining(['activated', 'idle']));
  });

  it('on stop, generates minutes and marks ended_at', async () => {
    const { session, asr, persistence } = makeSession();
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', 'hello');
    await flush();
    await session.stop();
    const full = await persistence.readMeeting(session.id!);
    expect(full.meta.ended_at).not.toBeNull();
    expect(full.minutesMd).toContain('# Meeting');
  });
});
