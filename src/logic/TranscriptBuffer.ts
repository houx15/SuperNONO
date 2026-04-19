import type { Utterance } from './types';

export class TranscriptBuffer {
  private finals: Utterance[] = [];
  private currentPartial: Utterance | null = null;
  private lastSummaryAt = 0;

  append(u: Utterance) {
    if (u.final) {
      this.finals.push(u);
      this.currentPartial = null;
    } else {
      this.currentPartial = u;
    }
  }

  all(): Utterance[] {
    return [...this.finals];
  }

  currentPartialUtterance(): Utterance | null {
    return this.currentPartial;
  }

  sinceTimestamp(t: number): Utterance[] {
    return this.finals.filter((u) => u.t >= t);
  }

  lastNMinutes(n: number, nowMs: number): Utterance[] {
    const cutoff = nowMs - n * 60_000;
    return this.finals.filter((u) => u.t >= cutoff);
  }

  markSummarizedAt(t: number) {
    this.lastSummaryAt = t;
  }

  sinceLastSummary(): Utterance[] {
    return this.finals.filter((u) => u.t >= this.lastSummaryAt);
  }
}
