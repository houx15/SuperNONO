import { describe, it, expect } from 'vitest';
import { MeetingSession } from './MeetingSession';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeLlmClient } from './__fakes__/FakeLlmClient';
import { FakeMicCapture } from './__fakes__/FakeMicCapture';
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
  const mic = new FakeMicCapture();
  const session = new MeetingSession({
    asr,
    e2e,
    llm,
    persistence,
    clock,
    mic,
    config: { wakeWord: DEFAULT_WAKE_WORD, lang: 'zh' },
  });
  return { session, asr, e2e, llm, persistence, clock, mic };
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
    asr.scriptFinal({ t: 1, speaker: 'S1', text: 'hello world', final: true });
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
    asr.scriptFinal({ t: 1, speaker: 'S1', text: 'lots of content to summarise', final: true });
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(summaries.length).toBe(1);
  });

  it('triggers Q&A when wake word is heard', async () => {
    const { session, asr, e2e, clock } = makeSession();
    const orbStates: string[] = [];
    session.on('orbState', (s) => orbStates.push(s as string));
    await session.start('Meeting');
    asr.scriptFinal({ t: 1, speaker: 'S1', text: '嘿 Nono, 查价格', final: true });
    // Flush so MeetingSession routes utterance to wake-word matcher and triggers QaHandoff,
    // which asynchronously opens E2E. Then script the E2E turn.
    await flush();
    e2e.scriptTurn({ question: '价格?', answer: '12-28 USD', audioChunks: [new Uint8Array([1])] });
    await flush();
    // Q&A is now multi-turn: after turn_end we sit in a follow-up
    // listen window and only return to idle on silence timeout.
    clock.advance(3_100);
    await flush();
    expect(orbStates).toEqual(expect.arrayContaining(['activated', 'idle']));
  });

  it('on stop, generates minutes and marks ended_at', async () => {
    const { session, asr, persistence } = makeSession();
    await session.start('Meeting');
    asr.scriptFinal({ t: 1, speaker: 'S1', text: 'hello', final: true });
    await flush();
    await session.stop();
    const full = await persistence.readMeeting(session.id!);
    expect(full.meta.ended_at).not.toBeNull();
    expect(full.minutesMd).toContain('# Meeting');
  });

  it('routes mic chunks to ASR by default', async () => {
    const { session, asr, mic } = makeSession();
    await session.start('Meeting');
    mic.scriptChunk(new Uint8Array([1, 2, 3]));
    mic.scriptChunk(new Uint8Array([4]));
    expect(asr.sentChunks.length).toBe(2);
  });

  it('emits amplitude from mic rms', async () => {
    const { session, mic } = makeSession();
    const levels: number[] = [];
    session.on('orbState', (s) => {
      if (typeof (s as { amplitude?: number }).amplitude === 'number')
        levels.push((s as { amplitude: number }).amplitude);
    });
    await session.start('Meeting');
    mic.scriptRms(0.3);
    mic.scriptRms(0.7);
    expect(levels).toEqual([0.3, 0.7]);
  });

  it('retryable error triggers reconnecting status then listening', async () => {
    const { session, asr, clock } = makeSession();
    const statuses: string[] = [];
    session.on('statusChange', (s) => statuses.push(s as string));
    await session.start('Meeting');
    expect(statuses).toContain('listening');
    asr.emitError({ kind: 'network', message: 'drop', retryable: true });
    await Promise.resolve();
    expect(statuses).toContain('reconnecting');
    // advance backoff 1s
    clock.advance(1000);
    await Promise.resolve();
    expect(statuses).toContain('listening');
  });

  it('three retryable errors in a row → paused', async () => {
    const { session, asr, clock } = makeSession();
    const statuses: string[] = [];
    session.on('statusChange', (s) => statuses.push(s as string));
    await session.start('Meeting');
    // Make all reconnect start() calls fail so attempt counter is never reset
    asr.failNextNStarts(3);
    // First error: attempt=0, schedules 1000ms backoff
    asr.emitError({ kind: 'network', message: 'x', retryable: true });
    await flush(); // → 'reconnecting'
    clock.advance(1010);
    await flush(); // tryReconnect fires, asr.start() throws → tryReconnect(attempt=1)
    // Second backoff: 3000ms
    clock.advance(3010);
    await flush(); // tryReconnect fires, asr.start() throws → tryReconnect(attempt=2)
    // Third backoff: 9000ms
    clock.advance(9010);
    await flush(); // tryReconnect fires, asr.start() throws → attempt=3 → paused
    expect(statuses[statuses.length - 1]).toBe('paused');
  });

  it('non-retryable error → paused immediately', async () => {
    const { session, asr } = makeSession();
    const statuses: string[] = [];
    session.on('statusChange', (s) => statuses.push(s as string));
    await session.start('Meeting');
    asr.emitError({ kind: 'auth', message: 'bad key', retryable: false });
    await Promise.resolve();
    expect(statuses[statuses.length - 1]).toBe('paused');
  });

  it('resume from paused re-triggers connect', async () => {
    const { session, asr } = makeSession();
    const statuses: string[] = [];
    session.on('statusChange', (s) => statuses.push(s as string));
    await session.start('Meeting');
    asr.emitError({ kind: 'auth', message: 'x', retryable: false });
    await Promise.resolve();
    await session.resume();
    expect(statuses[statuses.length - 1]).toBe('listening');
  });
});
