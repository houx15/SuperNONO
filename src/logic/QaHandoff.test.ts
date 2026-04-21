import { describe, it, expect, vi } from 'vitest';
import { QaHandoff } from './QaHandoff';
import { AudioRouter } from './AudioRouter';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeClock } from './__fakes__/FakeClock';
import { TranscriptBuffer } from './TranscriptBuffer';

describe('QaHandoff', () => {
  it('runs a complete Q&A turn without tearing down ASR', async () => {
    // Q&A handoff used to `asr.stop()` + `asr.start()` on each turn for
    // latency reasons we can now skip: with AudioRouter, mic chunks are
    // just redirected to E2E while ASR stays connected in the background.
    // Saves ~1 s of handshake per Q&A.
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
    e2e.scriptTurn({
      question: 'Q?',
      answer: 'A.',
      audioChunks: [new Uint8Array([1])],
    });
    await turnDone;

    expect(asrStopSpy).not.toHaveBeenCalled();
    // Only the initial `asr.start()` from the test setup; handoff no
    // longer re-starts ASR.
    expect(asrStartSpy).toHaveBeenCalledTimes(1);
    expect(orbStates).toEqual(
      expect.arrayContaining(['activated', 'thinking', 'speaking', 'idle']),
    );
    expect(exchanges.length).toBe(1);
  });

  it('routes mic e2e → drop (while Nono speaks) → asr (after drain)', async () => {
    // The 'drop' step prevents the speaker's own TTS output from being
    // captured by the mic and looped back into either e2e or ASR. If it
    // regresses, the user hears Nono feeding itself ("它外放的声音会被
    // 自己又送回去").
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
    await done;

    expect(spy.mock.calls.map((c) => c[0])).toEqual(['e2e', 'drop', 'asr']);
  });
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
