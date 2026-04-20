import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicCapture } from './MicCapture';

// A minimal fake of the AudioContext surface we use.
class FakeWorkletPort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  fire(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
class FakeWorkletNode {
  port = new FakeWorkletPort();
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeMediaStreamSource {
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createMediaStreamSource = vi.fn(() => new FakeMediaStreamSource());
  close = vi.fn();
  workletNode = new FakeWorkletNode();
}

describe('MicCapture', () => {
  let ctx: FakeAudioContext;
  let getStream: ReturnType<typeof vi.fn>;
  let buildNode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    getStream = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    buildNode = vi.fn().mockReturnValue(ctx.workletNode);
  });

  it('starts, adds worklet, wires node', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream as unknown as (c: MediaStreamConstraints) => Promise<MediaStream>,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode: buildNode as unknown as (ctx: AudioContext) => AudioWorkletNode,
    });
    await m.start();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('/worklet/downsample-worklet.js');
    expect(buildNode).toHaveBeenCalled();
  });

  it('emits chunk from worklet port message', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream as unknown as (c: MediaStreamConstraints) => Promise<MediaStream>,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode: buildNode as unknown as (ctx: AudioContext) => AudioWorkletNode,
    });
    await m.start();
    const chunks: Uint8Array[] = [];
    m.on('chunk', (c) => chunks.push(c));
    const buf = new Int16Array([1, -1, 2]).buffer;
    ctx.workletNode.port.fire({ type: 'chunk', buffer: buf });
    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(6);
  });

  it('emits rms', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream as unknown as (c: MediaStreamConstraints) => Promise<MediaStream>,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode: buildNode as unknown as (ctx: AudioContext) => AudioWorkletNode,
    });
    await m.start();
    const seen: number[] = [];
    m.on('rms', (r) => seen.push(r));
    ctx.workletNode.port.fire({ type: 'rms', value: 0.42 });
    expect(seen).toEqual([0.42]);
  });

  it('stop closes audio resources', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream as unknown as (c: MediaStreamConstraints) => Promise<MediaStream>,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode: buildNode as unknown as (ctx: AudioContext) => AudioWorkletNode,
    });
    await m.start();
    await m.stop();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('emits error event when getUserMedia rejects', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: failing as unknown as (c: MediaStreamConstraints) => Promise<MediaStream>,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode: buildNode as unknown as (ctx: AudioContext) => AudioWorkletNode,
    });
    await expect(m.start()).rejects.toThrow('NotAllowedError');
  });
});
