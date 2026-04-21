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

/** Absolute ceiling on the whole Q&A session (all turns). If neither
 *  the exit phrase, the silence timeout, nor any server signal resolve
 *  us, force-close so a stuck session can't freeze the meeting. */
const QA_HARD_TIMEOUT_MS = 120_000;

/** After Nono finishes a turn, how long to wait for the user to start
 *  a follow-up before closing the session and handing the mic back to
 *  the meeting transcriber. The user asked for 1 s — short enough that
 *  resuming normal meeting chatter re-engages ASR quickly, long enough
 *  to bridge a breath between questions. */
const FOLLOWUP_SILENCE_MS = 1000;

/** Phrases in the question transcript that mean "I'm done, thanks."
 *  Normalized with the same rules as WakeWordMatcher (lowercase, strip
 *  whitespace + CJK punctuation) before substring-matching, so minor
 *  ASR variation ("就这样吧。" vs "就 这样 吧") doesn't miss. */
const EXIT_PHRASES = [
  '好了你退下吧',
  '你退下吧',
  '就这样吧',
  '就这样',
  '没事了',
  '谢谢nono',
  'thanks nono',
  'thank you nono',
  'finish',
  'stop nono',
  'goodbye nono',
];

function normalizeForExit(s: string): string {
  return s.toLowerCase().replace(/[\s,.!?;:，。！？；：、]/g, '');
}

export function isExitPhrase(question: string): boolean {
  const n = normalizeForExit(question);
  if (!n) return false;
  return EXIT_PHRASES.some((p) => n.includes(normalizeForExit(p)));
}

type EndReason = 'silence' | 'exit_phrase' | 'error' | 'timeout' | 'cancel';

export class QaHandoff {
  private active = false;
  private cancelFn: (() => void) | null = null;

  constructor(private deps: QaHandoffDeps) {}

  /** User-initiated cancel (ESC key, Cancel button). Ends the Q&A
   *  session immediately regardless of which turn/phase it's in. */
  cancel(): void {
    this.cancelFn?.();
  }

  isActive(): boolean {
    return this.active;
  }

  async trigger(): Promise<void> {
    if (this.active) return;
    this.active = true;

    // Route mic to e2e for the initial question. During Nono's reply
    // we'll switch to 'drop' to prevent speaker→mic echo; after each
    // reply ends we switch back to 'e2e' to listen for a follow-up.
    this.deps.router?.switchTo('e2e');
    this.deps.onOrbState('activated');

    const systemPrompt = this.buildSystemPrompt();
    const e2e = this.deps.e2e;
    const cleanup: Array<() => void> = [];
    const hook = <T extends string>(event: T, fn: (p: unknown) => void) => {
      const unsub = e2e.on(event as never, fn);
      cleanup.push(unsub);
    };

    // Shared state mutated by server events; read at turn boundaries.
    let question = '';
    let answer = '';
    // Resolvers for the two phases: awaiting turn_end, and awaiting
    // user activity during the silence window.
    let resolveTurnEnd: ((r: EndReason | 'turn_end') => void) | null = null;
    let resolveActivity: ((gotActivity: boolean) => void) | null = null;
    // If a turn_end arrives before the next iteration is awaiting it
    // (the FakeE2eClient scriptTurn fires everything synchronously,
    // and real servers can too when a turn is very short) we'd lose
    // the signal. Buffer it so the next await resolves immediately.
    let pendingTurnEnd: EndReason | 'turn_end' | null = null;

    const finishTurn = (r: EndReason | 'turn_end') => {
      if (resolveTurnEnd) {
        const fn = resolveTurnEnd;
        resolveTurnEnd = null;
        fn(r);
      } else {
        pendingTurnEnd = r;
      }
    };
    const markActivity = () => {
      // Activity during the silence window means "user wants another
      // turn." Reset per-turn transcripts HERE — not at the next loop
      // iteration — because the subsequent question_transcript /
      // answer_transcript events can arrive synchronously in the same
      // emit sequence as the user_speaking signal, and resetting
      // after they land would wipe them.
      if (resolveActivity) {
        const fn = resolveActivity;
        resolveActivity = null;
        question = '';
        answer = '';
        fn(true);
      }
    };

    hook('question_transcript', (p) => {
      question = (p as { text: string }).text ?? '';
      this.deps.onOrbState('thinking');
      markActivity();
    });
    hook('user_speaking', () => {
      // Volcano's ASRInfo — fires on the first recognized character of
      // the user's new utterance. Earliest possible "still talking"
      // signal, so the silence timer resets as soon as the user opens
      // their mouth rather than waiting for a full recognized sentence.
      markActivity();
    });
    hook('answer_transcript', (p) => {
      answer = (p as { text: string }).text ?? '';
    });
    hook('audio', (c) => {
      this.deps.onAudioChunk?.(c as Uint8Array);
      this.deps.onOrbState('speaking');
      // Once Nono starts speaking, stop feeding mic chunks anywhere —
      // otherwise the speaker output loops back through the mic and
      // gets sent to e2e as a fake interrupt. Held through turn_end
      // and past the audio-player drain.
      this.deps.router?.switchTo('drop');
    });
    hook('turn_end', () => finishTurn('turn_end'));
    hook('error', () => finishTurn('error'));

    // Session-level cancel + hard ceiling apply to all turns together.
    this.cancelFn = () => {
      finishTurn('cancel');
      if (resolveActivity) {
        const fn = resolveActivity;
        resolveActivity = null;
        fn(false);
      }
    };
    const hardTimeoutHandle: ReturnType<typeof setTimeout> = setTimeout(() => {
      finishTurn('timeout');
      if (resolveActivity) {
        const fn = resolveActivity;
        resolveActivity = null;
        fn(false);
      }
    }, QA_HARD_TIMEOUT_MS);

    // Open e2e once. The server supports multi-turn dialogue in a
    // single session: we just keep the connection open between turns
    // and the server handles detecting each new user query.
    let openFailed = false;
    await e2e.open({ systemPrompt, voice: E2E_DEFAULT_VOICE }).catch(() => {
      openFailed = true;
      finishTurn('error');
    });

    let exitReason: EndReason = 'silence';

    // Main multi-turn loop.
    while (this.active) {
      // Phase 1: wait for this turn to end (Nono finishes, or session
      // ends for another reason). Honor any signal that arrived
      // between turns before we got to wait on it.
      const turnResult = await new Promise<EndReason | 'turn_end'>((resolve) => {
        if (openFailed) {
          resolve('error');
          return;
        }
        if (pendingTurnEnd !== null) {
          const r = pendingTurnEnd;
          pendingTurnEnd = null;
          resolve(r);
          return;
        }
        resolveTurnEnd = resolve;
      });

      // Emit the exchange whatever the reason — the user still said
      // something and Nono may have partially replied.
      if (turnResult === 'cancel' && !answer) answer = '(cancelled)';
      if (turnResult === 'timeout' && !answer) {
        answer = '(turn ended: server silent — returned to listening)';
      }
      const t = this.deps.clock.now();
      const exchange: AiExchange = { t, question, answer, cites: [] };
      this.deps.onExchange(exchange);
      if (this.deps.onTranscriptBridge) {
        if (question) {
          this.deps.onTranscriptBridge({
            t,
            speaker: 'User (to Nono)',
            text: question,
            final: true,
          });
        }
        if (answer) {
          this.deps.onTranscriptBridge({
            t: t + 1,
            speaker: 'SuperNono',
            text: answer,
            final: true,
          });
        }
      }

      if (turnResult !== 'turn_end') {
        exitReason = turnResult;
        break;
      }
      if (isExitPhrase(question)) {
        exitReason = 'exit_phrase';
        break;
      }

      // Phase 2: drain Nono's audio buffer so the speaker tail doesn't
      // feed back into the mic, THEN listen for follow-up activity.
      const drainMs = this.deps.audioPlayerDrainMs?.() ?? 0;
      if (drainMs > 0) {
        await new Promise<void>((resolve) => {
          this.deps.clock.setTimeout(() => resolve(), drainMs + 200);
        });
      }
      this.deps.router?.switchTo('e2e');
      this.deps.onOrbState('activated');

      const gotActivity = await new Promise<boolean>((resolve) => {
        resolveActivity = resolve;
        this.deps.clock.setTimeout(() => {
          if (resolveActivity === resolve) {
            resolveActivity = null;
            resolve(false);
          }
        }, FOLLOWUP_SILENCE_MS);
      });

      if (!gotActivity) {
        exitReason = 'silence';
        break;
      }
      // Activity detected — loop around and wait for the next turn_end.
    }

    clearTimeout(hardTimeoutHandle);
    this.cancelFn = null;
    cleanup.forEach((fn) => fn());
    await e2e.close();

    // Final drain in case Nono was still speaking when the session
    // ended (exit phrase uttered mid-answer, cancel hit, etc.).
    const finalDrainMs = this.deps.audioPlayerDrainMs?.() ?? 0;
    if (finalDrainMs > 0) {
      await new Promise<void>((resolve) => {
        this.deps.clock.setTimeout(() => resolve(), finalDrainMs + 200);
      });
    }

    this.deps.router?.switchTo('asr');
    this.deps.onOrbState('idle');
    this.active = false;
    void exitReason; // kept for future telemetry / diagnostics hook
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
