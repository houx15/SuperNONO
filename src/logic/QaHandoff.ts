import type { AsrClient, E2eClient } from './adapters';
import type { Clock } from './clock';
import type { TranscriptBuffer } from './TranscriptBuffer';
import type { AiExchange, OrbState, Summary, Utterance } from './types';
import type { AudioRouter } from './AudioRouter';
import { MAX_RAW_WINDOW_MIN_QA, E2E_DEFAULT_VOICE } from './config';
import { activePrompts } from './prompts';

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
  /** Returns ms remaining until already-scheduled TTS audio has played
   *  out. Used to hold the router in 'drop' past turn_end so the speaker
   *  tail doesn't loop back into the mic. */
  audioPlayerDrainMs?: () => number;
}

/** Absolute ceiling on a single Q&A turn. If neither the server's
 *  `turn_end` nor an `error` event arrives within this window, we force-
 *  close and return to listening so a server hiccup can't freeze the
 *  whole meeting. 45 s covers a leisurely question + generous answer. */
const QA_HARD_TIMEOUT_MS = 45_000;

export class QaHandoff {
  private active = false;
  private cancelFn: (() => void) | null = null;

  constructor(private deps: QaHandoffDeps) {}

  /** User-initiated cancel (ESC key, Cancel button). Resolves the in-flight
   *  `trigger()` as if the server had sent `turn_end`. Safe to call when
   *  nothing is active. */
  cancel(): void {
    this.cancelFn?.();
  }

  isActive(): boolean {
    return this.active;
  }

  async trigger(): Promise<void> {
    if (this.active) return;
    this.active = true;
    // Route mic audio to E2E while Q&A runs. We deliberately do NOT close
    // the ASR WS any more — a close/open cycle adds ~1 s to every Q&A for
    // no real benefit; with the router swap, ASR just receives silence
    // for the 3–5 s of the Q&A, which Volcano tolerates well within its
    // inactivity window.
    this.deps.router?.switchTo('e2e');
    this.deps.onOrbState('activated');

    const systemPrompt = this.buildSystemPrompt();
    const e2e = this.deps.e2e;

    let question = '';
    let answer = '';
    type EndReason = 'turn_end' | 'error' | 'timeout' | 'cancel';
    // Wrapped in an object so TS control-flow analysis doesn't narrow
    // the string literal and trip up the post-await comparisons.
    const end: { reason: EndReason } = { reason: 'turn_end' };

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
      // Once Nono starts speaking, stop feeding mic chunks anywhere —
      // otherwise the speaker output loops back through the mic and
      // gets sent either to e2e (as a fake interrupt) or back to ASR
      // (transcribed as Nono's own words). User reported this as "它
      // 外放的声音会被自己又送回去." We hold 'drop' through turn_end
      // and past the player's drain so the last few hundred ms of
      // Nono's TTS tail don't leak in either.
      this.deps.router?.switchTo('drop');
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    await new Promise<void>((resolve) => {
      const done = (reason: EndReason) => {
        end.reason = reason;
        resolve();
      };
      // Server signals.
      hook('turn_end', () => done('turn_end'));
      hook('error', () => done('error'));
      // User-initiated cancel.
      this.cancelFn = () => done('cancel');
      // Hard ceiling — protects against a server that never sends turn_end.
      timeoutHandle = setTimeout(() => done('timeout'), QA_HARD_TIMEOUT_MS);
      // Kick off E2E open. If the open itself fails, treat as error.
      e2e.open({ systemPrompt, voice: E2E_DEFAULT_VOICE }).catch(() => done('error'));
    });

    if (timeoutHandle) clearTimeout(timeoutHandle);
    this.cancelFn = null;
    cleanup.forEach((fn) => fn());
    await e2e.close();

    if (end.reason === 'timeout') {
      // Surface on the exchange so it's visible the turn didn't finish
      // cleanly. The meeting still continues.
      if (!answer) answer = '(turn ended: server silent — returned to listening)';
    } else if (end.reason === 'cancel') {
      if (!answer) answer = '(cancelled)';
    }

    const t = this.deps.clock.now();
    const exchange: AiExchange = { t, question, answer, cites: [] };
    this.deps.onExchange(exchange);
    if (this.deps.onTranscriptBridge) {
      if (question)
        this.deps.onTranscriptBridge({ t, speaker: 'User (to Nono)', text: question, final: true });
      if (answer)
        this.deps.onTranscriptBridge({ t: t + 1, speaker: 'SuperNono', text: answer, final: true });
    }

    // Wait for any queued TTS audio to finish playing out the speaker
    // before routing the mic back to ASR. Without this the mic captures
    // the ~1–2 s tail of Nono's answer still draining from the Web
    // Audio buffer and feeds it into ASR as a self-transcribed sentence.
    const drainMs = this.deps.audioPlayerDrainMs?.() ?? 0;
    if (drainMs > 0) {
      await new Promise<void>((resolve) => {
        this.deps.clock.setTimeout(() => resolve(), drainMs + 200);
      });
    }

    // ASR stayed connected throughout; just route chunks back to it.
    this.deps.router?.switchTo('asr');
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
      activePrompts().qaSystemPreamble,
      '---SUMMARIES---',
      summariesText,
      '---RECENT---',
      recent,
    ].join('\n');
  }
}
