import { describe, it, expect, vi } from 'vitest';
import { AnswerAudioPlayer } from './AnswerAudioPlayer';

function mockCtx() {
  const source = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as unknown,
  };
  const ctx = {
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createBuffer: vi.fn(
      (ch: number, len: number, rate: number) =>
        ({
          numberOfChannels: ch,
          length: len,
          sampleRate: rate,
          getChannelData: () => new Float32Array(len),
        }) as unknown as AudioBuffer,
    ),
    createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
  } as unknown as AudioContext;
  return { ctx, source };
}

describe('AnswerAudioPlayer', () => {
  it('decodes s16le bytes as PCM at 24 kHz mono', () => {
    const { ctx, source } = mockCtx();
    const p = new AnswerAudioPlayer(ctx);
    // 4 samples of s16le = 8 bytes. Pick values bracketing the int16 range.
    const int16 = new Int16Array([0, 16384, -16384, 32767]);
    p.enqueue(new Uint8Array(int16.buffer));

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 4, 24000);
    expect(source.start).toHaveBeenCalledTimes(1);
  });

  it('handles odd byte length by truncating to an even count', () => {
    const { ctx } = mockCtx();
    const p = new AnswerAudioPlayer(ctx);
    // 9 bytes = 4 samples + 1 trailing byte dropped.
    const chunk = new Uint8Array(9);
    chunk.set([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x34, 0x12, 0xaa]);
    p.enqueue(chunk);
    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 4, 24000);
  });

  it('ignores too-short chunks', () => {
    const { ctx } = mockCtx();
    const p = new AnswerAudioPlayer(ctx);
    p.enqueue(new Uint8Array([0x00])); // 1 byte — can't form a sample
    expect(ctx.createBuffer).not.toHaveBeenCalled();
  });

  it('stop() prevents further scheduling', () => {
    const { ctx } = mockCtx();
    const p = new AnswerAudioPlayer(ctx);
    p.enqueue(new Uint8Array(new Int16Array([1]).buffer));
    p.stop();
    const beforeSecond = (ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length;
    p.enqueue(new Uint8Array(new Int16Array([2]).buffer));
    expect((ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      beforeSecond,
    );
  });
});
