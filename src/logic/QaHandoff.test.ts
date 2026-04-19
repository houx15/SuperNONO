import { describe, it, expect, vi } from 'vitest';
import { QaHandoff } from './QaHandoff';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeClock } from './__fakes__/FakeClock';
import { TranscriptBuffer } from './TranscriptBuffer';

describe('QaHandoff', () => {
  it('runs a complete Q&A turn and resumes ASR', async () => {
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

    // Start the turn (does not resolve until e2e emits turn_end)
    const turnDone = qa.trigger();

    // After microtask flush, ASR is stopped and e2e opened; emit the scripted turn.
    await flush();
    e2e.scriptTurn({
      question: 'Q?',
      answer: 'A.',
      audioChunks: [new Uint8Array([1])],
    });

    await turnDone;

    expect(asrStopSpy).toHaveBeenCalled();
    expect(orbStates).toEqual(
      expect.arrayContaining(['activated', 'thinking', 'speaking', 'idle']),
    );
    expect(exchanges.length).toBe(1);
    expect(asrStartSpy).toHaveBeenCalledTimes(2); // initial + resume
  });
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
