import { describe, it, expect, vi } from 'vitest';
import { FakeMicCapture } from './FakeMicCapture';

describe('FakeMicCapture', () => {
  it('buffers chunks until started', async () => {
    const m = new FakeMicCapture();
    const spy = vi.fn();
    m.on('chunk', spy);
    m.scriptChunk(new Uint8Array([1]));
    expect(spy).not.toHaveBeenCalled();
    await m.start();
    m.scriptChunk(new Uint8Array([2]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits rms', async () => {
    const m = new FakeMicCapture();
    await m.start();
    const rms: number[] = [];
    m.on('rms', (r) => rms.push(r));
    m.scriptRms(0.1);
    m.scriptRms(0.5);
    expect(rms).toEqual([0.1, 0.5]);
  });

  it('stop suppresses further emissions', async () => {
    const m = new FakeMicCapture();
    await m.start();
    const spy = vi.fn();
    m.on('chunk', spy);
    await m.stop();
    m.scriptChunk(new Uint8Array([1]));
    expect(spy).not.toHaveBeenCalled();
  });
});
