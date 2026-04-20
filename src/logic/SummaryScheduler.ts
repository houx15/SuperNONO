import type { Clock } from './clock';
import type { TranscriptBuffer } from './TranscriptBuffer';
import type { Summary } from './types';
import {
  SUMMARY_INTERVAL_MS,
  FIRST_SUMMARY_MS,
  MAX_RAW_WINDOW_MIN_SUMMARY,
  MAX_CONTEXT_CHARS,
} from './config';
import { activePrompts } from './prompts';

export interface LlmMinimal {
  complete(req: { prompt: string }): Promise<{ text: string }>;
}

export interface SummarySchedulerDeps {
  clock: Clock;
  buffer: TranscriptBuffer;
  llm: LlmMinimal;
  onSummary: (s: Summary) => void;
}

export class SummaryScheduler {
  private running = false;
  private previous: Summary | null = null;
  private hasFired = false;

  constructor(private deps: SummarySchedulerDeps) {}

  start() {
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
  }

  private schedule() {
    if (!this.running) return;
    // First summary fires early (FIRST_SUMMARY_MS ≈ 60 s) so the user sees
    // something quickly. Subsequent summaries use the full 5-min cadence.
    const delay = this.hasFired ? SUMMARY_INTERVAL_MS : FIRST_SUMMARY_MS;
    this.deps.clock.setTimeout(async () => {
      await this.tick();
      this.hasFired = true;
      this.schedule();
    }, delay);
  }

  private async tick() {
    const newUtterances = this.deps.buffer.sinceLastSummary();
    if (newUtterances.length === 0) return;

    const windowText = this.deps.buffer
      .lastNMinutes(MAX_RAW_WINDOW_MIN_SUMMARY, this.deps.clock.now())
      .map((u) => `[${u.speaker}] ${u.text}`)
      .join('\n')
      .slice(-MAX_CONTEXT_CHARS);

    const prompt = buildSummaryPrompt(this.previous, windowText);

    try {
      const resp = await this.deps.llm.complete({ prompt });
      const parsed = JSON.parse(resp.text) as { topic: string; text: string; sameTopic: boolean };
      const now = this.deps.clock.now();
      const startedAt = this.previous?.endedAt ?? now - SUMMARY_INTERVAL_MS;
      const summary: Summary = {
        time: formatRange(startedAt, now),
        topic: parsed.topic,
        text: parsed.text,
        speakers: null,
        state: 'done',
        startedAt,
        endedAt: now,
      };
      this.previous = summary;
      this.deps.buffer.markSummarizedAt(now);
      this.deps.onSummary(summary);
    } catch {
      // skip this tick; try again next interval
    }
  }
}

function buildSummaryPrompt(prev: Summary | null, recent: string): string {
  return activePrompts().buildSummaryPrompt(prev, recent);
}

function formatRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  return `${fmt(startMs)} — ${fmt(endMs)}`;
}
