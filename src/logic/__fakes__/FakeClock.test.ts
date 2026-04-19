import { describe, it, expect, vi } from 'vitest';
import { FakeClock } from './FakeClock';

describe('FakeClock', () => {
  it('fires timers in order after advancing', () => {
    const clock = new FakeClock(1000);
    const order: string[] = [];
    clock.setTimeout(() => order.push('a'), 500);
    clock.setTimeout(() => order.push('b'), 200);
    clock.advance(600);
    expect(order).toEqual(['b', 'a']);
  });

  it('cancels a timer', () => {
    const clock = new FakeClock(0);
    const fn = vi.fn();
    const h = clock.setTimeout(fn, 100);
    clock.clearTimeout(h);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports current time', () => {
    const clock = new FakeClock(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });
});
