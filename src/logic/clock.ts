export type TimerHandle = number;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

export class RealClock implements Clock {
  now() {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number) {
    return window.setTimeout(fn, ms) as unknown as TimerHandle;
  }
  clearTimeout(h: TimerHandle) {
    window.clearTimeout(h as unknown as number);
  }
}
