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

  it('switchTo changes sink atomically', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    const r = new AudioRouter({ asr, e2e });
    r.feed(new Uint8Array([1])); // → asr
    r.switchTo('e2e');
    r.feed(new Uint8Array([2])); // → e2e
    r.feed(new Uint8Array([3])); // → e2e
    r.switchTo('asr');
    r.feed(new Uint8Array([4])); // → asr
    expect(asr).toHaveBeenCalledTimes(2);
    expect(e2e).toHaveBeenCalledTimes(2);
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
