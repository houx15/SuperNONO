import { describe, it, expect, vi } from 'vitest';
import { AnswerAudioPlayer } from './AnswerAudioPlayer';

describe('AnswerAudioPlayer', () => {
  it('queues chunks and schedules buffers back-to-back', () => {
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(),
      onended: null as unknown,
    };
    const ctx = {
      currentTime: 0,
      destination: {} as AudioDestinationNode,
      createBuffer: vi.fn((ch: number, len: number, rate: number) => {
        return {
          numberOfChannels: ch,
          length: len,
          sampleRate: rate,
          getChannelData: () => new Float32Array(len),
        } as unknown as AudioBuffer;
      }),
      createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
    } as unknown as AudioContext;

    const p = new AnswerAudioPlayer(ctx);
    // 4 samples of float32 = 16 bytes
    const pcm = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    p.enqueue(new Uint8Array(pcm.buffer));

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 4, 24000);
    expect(source.start).toHaveBeenCalledTimes(1);
  });

  it('stop() clears queue and prevents further scheduling', () => {
    const source = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as unknown,
    };
    const ctx = {
      currentTime: 0,
      destination: {} as AudioDestinationNode,
      createBuffer: vi.fn(
        (_c: number, len: number) =>
          ({ length: len, getChannelData: () => new Float32Array(len) }) as unknown as AudioBuffer,
      ),
      createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
    } as unknown as AudioContext;

    const p = new AnswerAudioPlayer(ctx);
    p.enqueue(new Uint8Array(new Float32Array([0.1]).buffer));
    p.stop();
    // Further enqueue after stop should noop.
    const calls = (ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length;
    p.enqueue(new Uint8Array(new Float32Array([0.2]).buffer));
    expect((ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});
