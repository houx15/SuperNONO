import type { AsrClient, E2eClient } from './adapters';
import type { Clock } from './clock';
import type { TranscriptBuffer } from './TranscriptBuffer';
import type { AiExchange, OrbState, Summary, Utterance } from './types';
import type { AudioRouter } from './AudioRouter';
import { MAX_RAW_WINDOW_MIN_QA, E2E_DEFAULT_VOICE, QA_SYSTEM_PROMPT_PREAMBLE } from './config';

export interface QaHandoffDeps {
  asr: AsrClient;
  e2e: E2eClient;
  clock: Clock;
  buffer: TranscriptBuffer;
  summaries: () => Summary[];
  router?: AudioRouter;
  onOrbState: (s: OrbState) => void;
  onExchange: (x: AiExchange) => void;
  onTranscriptBridge?: (u: Utterance) => void;
  onAudioChunk?: (c: Uint8Array) => void;
}

export class QaHandoff {
  private active = false;

  constructor(private deps: QaHandoffDeps) {}

  async trigger(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.deps.router?.switchTo('e2e');
    this.deps.onOrbState('activated');
    await this.deps.asr.stop();

    const systemPrompt = this.buildSystemPrompt();
    const e2e = this.deps.e2e;

    let question = '';
    let answer = '';

    const cleanup: Array<() => void> = [];
    const hook = <T extends string>(event: T, fn: (p: unknown) => void) => {
      const unsub = e2e.on(event as never, fn);
      cleanup.push(unsub);
    };

    hook('question_transcript', (p) => {
      question = (p as { text: string }).text ?? '';
      this.deps.onOrbState('thinking');
    });
    hook('answer_transcript', (p) => {
      answer = (p as { text: string }).text ?? '';
    });
    hook('audio', (c) => {
      this.deps.onAudioChunk?.(c as Uint8Array);
      this.deps.onOrbState('speaking');
    });

    await new Promise<void>((resolve) => {
      hook('turn_end', () => resolve());
      hook('error', () => resolve());
      e2e.open({ systemPrompt, voice: E2E_DEFAULT_VOICE }).catch(() => resolve());
    });

    cleanup.forEach((fn) => fn());
    await e2e.close();

    const t = this.deps.clock.now();
    const exchange: AiExchange = { t, question, answer, cites: [] };
    this.deps.onExchange(exchange);
    if (this.deps.onTranscriptBridge) {
      if (question)
        this.deps.onTranscriptBridge({ t, speaker: 'User (to Nono)', text: question, final: true });
      if (answer)
        this.deps.onTranscriptBridge({ t: t + 1, speaker: 'SuperNono', text: answer, final: true });
    }

    this.deps.router?.switchTo('asr');
    await this.deps.asr.start({ lang: 'zh', enableSpeakerId: true });
    this.deps.onOrbState('idle');
    this.active = false;
  }

  private buildSystemPrompt(): string {
    const summaries = this.deps.summaries();
    const summariesText = summaries.map((s) => `- ${s.topic}: ${s.text}`).join('\n');
    const recent = this.deps.buffer
      .lastNMinutes(MAX_RAW_WINDOW_MIN_QA, this.deps.clock.now())
      .map((u) => `[${u.speaker}] ${u.text}`)
      .join('\n');
    return [
      QA_SYSTEM_PROMPT_PREAMBLE,
      '---SUMMARIES---',
      summariesText,
      '---RECENT---',
      recent,
    ].join('\n');
  }
}
