import type { Clock, TimerHandle } from '../clock';

interface ScheduledTimer {
  id: TimerHandle;
  fireAt: number;
  fn: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private current: number;
  private nextId = 1;
  private timers: ScheduledTimer[] = [];

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now() {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer = { id: this.nextId++, fireAt: this.current + ms, fn, cancelled: false };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(h: TimerHandle) {
    const t = this.timers.find((x) => x.id === h);
    if (t) t.cancelled = true;
  }

  advance(ms: number) {
    const target = this.current + ms;
    while (true) {
      const next = this.timers
        .filter((t) => !t.cancelled && t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.current = next.fireAt;
      next.cancelled = true;
      next.fn();
    }
    this.current = target;
  }
}
