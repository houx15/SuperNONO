import { describe, it, expect, vi } from 'vitest';
import { QaHandoff, isExitPhrase } from './QaHandoff';
import { AudioRouter } from './AudioRouter';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeClock } from './__fakes__/FakeClock';
import { TranscriptBuffer } from './TranscriptBuffer';

describe('QaHandoff', () => {
  it('closes the session after one turn if no follow-up arrives within 1 s', async () => {
    // Baseline single-turn flow: user asks, Nono answers, user goes
    // quiet — session closes on silence timeout and mic returns to ASR.
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const clock = new FakeClock(10_000);
    const buf = new TranscriptBuffer();
    const asrStopSpy = vi.spyOn(asr, 'stop');
    const asrStartSpy = vi.spyOn(asr, 'start');
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    const orbStates: string[] = [];
    const exchanges: unknown[] = [];

    const qa = new QaHandoff({
      asr,
      e2e,
      clock,
      buffer: buf,
      summaries: () => [],
      onOrbState: (s) => orbStates.push(s),
      onExchange: (x) => exchanges.push(x),
    });

    const turnDone = qa.trigger();
    await flush();
    e2e.scriptTurn({ question: 'Q?', answer: 'A.', audioChunks: [new Uint8Array([1])] });
    await flush();
    // Silence window — nothing further happens for 1 s.
    clock.advance(1_100);
    await turnDone;

    expect(asrStopSpy).not.toHaveBeenCalled();
    // Only the initial asr.start() from the test setup; the session
    // does not tear down ASR between turns.
    expect(asrStartSpy).toHaveBeenCalledTimes(1);
    expect(orbStates).toEqual(
      expect.arrayContaining(['activated', 'thinking', 'speaking', 'idle']),
    );
    expect(exchanges.length).toBe(1);
  });

  it('continues into a second turn if the user speaks before the silence window elapses', async () => {
    // This is the bug the user reported: "after nono responds I said
    // a second question, but it keeps silence." The fix is multi-turn:
    // if the user starts speaking (ASRInfo / question_transcript)
    // within FOLLOWUP_SILENCE_MS of turn_end, we stay open and wait
    // for the next turn_end.
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const clock = new FakeClock(10_000);
    const buf = new TranscriptBuffer();
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    const exchanges: unknown[] = [];

    const qa = new QaHandoff({
      asr,
      e2e,
      clock,
      buffer: buf,
      summaries: () => [],
      onOrbState: () => {},
      onExchange: (x) => exchanges.push(x),
    });

    const done = qa.trigger();
    await flush();
    e2e.scriptTurn({ question: 'Q1', answer: 'A1', audioChunks: [new Uint8Array([1])] });
    await flush();
    // Before the 1 s silence window elapses, the user starts speaking
    // again — scriptTurn's first event is 'user_speaking', which
    // cancels the silence timer.
    e2e.scriptTurn({ question: 'Q2', answer: 'A2', audioChunks: [new Uint8Array([2])] });
    await flush();
    clock.advance(1_100);
    await done;

    expect(exchanges.length).toBe(2);
    expect(exchanges[0]).toMatchObject({ question: 'Q1', answer: 'A1' });
    expect(exchanges[1]).toMatchObject({ question: 'Q2', answer: 'A2' });
  });

  it('exits immediately when the user utters an exit phrase', async () => {
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const clock = new FakeClock(10_000);
    const buf = new TranscriptBuffer();
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    const exchanges: unknown[] = [];

    const qa = new QaHandoff({
      asr,
      e2e,
      clock,
      buffer: buf,
      summaries: () => [],
      onOrbState: () => {},
      onExchange: (x) => exchanges.push(x),
    });

    const done = qa.trigger();
    await flush();
    e2e.scriptTurn({
      question: '就这样吧，谢谢',
      answer: '好的，随时叫我。',
      audioChunks: [new Uint8Array([1])],
    });
    // No clock.advance needed — exit-phrase bypasses the silence window.
    await done;

    expect(exchanges.length).toBe(1);
  });

  it('routes mic e2e → drop (while Nono speaks) → e2e (follow-up listen) → asr (on exit)', async () => {
    // Verifies the full router choreography. The 'drop' step prevents
    // speaker→mic echo during TTS playback ("它外放的声音会被自己又
    // 送回去"); 'e2e' during the follow-up window keeps the next
    // question routed to the dialogue session; 'asr' on exit hands
    // the meeting transcriber back its input.
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const clock = new FakeClock(10_000);
    const buf = new TranscriptBuffer();
    const router = new AudioRouter({ asr: (c) => asr.sendAudio(c), e2e: (c) => e2e.sendAudio(c) });
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    const spy = vi.spyOn(router, 'switchTo');

    const qa = new QaHandoff({
      asr,
      e2e,
      clock,
      buffer: buf,
      summaries: () => [],
      router,
      onOrbState: () => {},
      onExchange: () => {},
    });

    const done = qa.trigger();
    await flush();
    e2e.scriptTurn({ question: 'q', answer: 'a', audioChunks: [new Uint8Array([1])] });
    await flush();
    clock.advance(1_100);
    await done;

    expect(spy.mock.calls.map((c) => c[0])).toEqual(['e2e', 'drop', 'e2e', 'asr']);
  });
});

describe('isExitPhrase', () => {
  it('matches Chinese exit phrases with or without punctuation/whitespace', () => {
    expect(isExitPhrase('就这样吧')).toBe(true);
    expect(isExitPhrase('就 这样 吧。')).toBe(true);
    expect(isExitPhrase('好了你退下吧，谢谢')).toBe(true);
    expect(isExitPhrase('没事了')).toBe(true);
  });

  it('matches English exit phrases case-insensitively', () => {
    expect(isExitPhrase('Thanks Nono')).toBe(true);
    expect(isExitPhrase('Finish.')).toBe(true);
  });

  it('does not fire on unrelated questions', () => {
    expect(isExitPhrase('帮我总结一下')).toBe(false);
    expect(isExitPhrase('what is the capital of France')).toBe(false);
    expect(isExitPhrase('')).toBe(false);
  });
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
