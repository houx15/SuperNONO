import { describe, it, expect, vi } from 'vitest';
import { AudioRouter } from './AudioRouter';

describe('AudioRouter', () => {
  it('routes to active sink only', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    const r = new AudioRouter({ asr, e2e });
    r.feed(new Uint8Array([1]));
    expect(asr).toHaveBeenCalledTimes(1);
    expect(e2e).not.toHaveBeenCalled();
  });

  it('routes real audio to the active sink and silence to ASR when idle', () => {
    // In 'e2e' and 'drop' modes we also send a silence chunk to ASR so
    // Volcano doesn't close the stream for inactivity (~30 s timeout).
    // This is the keep-alive that stopped the post-Q&A "always
    // reconnecting" loop.
    const asr = vi.fn();
    const e2e = vi.fn();
    const r = new AudioRouter({ asr, e2e });
    r.feed(new Uint8Array([1, 1])); // → asr (real audio)
    expect(asr).toHaveBeenLastCalledWith(new Uint8Array([1, 1]));

    r.switchTo('e2e');
    r.feed(new Uint8Array([2, 2])); // → e2e real + asr silence
    expect(e2e).toHaveBeenLastCalledWith(new Uint8Array([2, 2]));
    expect(asr).toHaveBeenLastCalledWith(new Uint8Array([0, 0]));

    r.switchTo('drop');
    r.feed(new Uint8Array([3, 3, 3])); // → asr silence only, nothing to e2e
    expect(asr).toHaveBeenLastCalledWith(new Uint8Array([0, 0, 0]));
    expect(e2e).toHaveBeenCalledTimes(1); // unchanged

    r.switchTo('asr');
    r.feed(new Uint8Array([4, 4])); // → asr real
    expect(asr).toHaveBeenLastCalledWith(new Uint8Array([4, 4]));
  });

  it('defaults to asr', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    new AudioRouter({ asr, e2e }).feed(new Uint8Array([9]));
    expect(asr).toHaveBeenCalled();
  });

  it('exposes current active sink', () => {
    const r = new AudioRouter({ asr: vi.fn(), e2e: vi.fn() });
    expect(r.active).toBe('asr');
    r.switchTo('e2e');
    expect(r.active).toBe('e2e');
  });
});
