import type { AsrClient, E2eClient, LlmClient, MicCaptureHandle, Persistence } from './adapters';
import type { Clock } from './clock';
import type { AiExchange, AsrError, MeetingMeta, OrbState, Summary, Utterance } from './types';
import { SCHEMA_VERSION, makeMeetingId } from './types';
import { TranscriptBuffer } from './TranscriptBuffer';
import { WakeWordMatcher } from './WakeWordMatcher';
import { SummaryScheduler } from './SummaryScheduler';
import { QaHandoff } from './QaHandoff';
import { AudioRouter } from './AudioRouter';
import { MinutesRenderer } from './MinutesRenderer';

type EventName = 'transcript' | 'summary' | 'qa' | 'qaLive' | 'orbState' | 'error' | 'statusChange';
type Handler = (payload: unknown) => void;

export interface MeetingSessionConfig {
  wakeWord: string;
  lang: 'zh' | 'en';
}

export interface MeetingSessionDeps {
  asr: AsrClient;
  e2e: E2eClient;
  llm: LlmClient;
  persistence: Persistence;
  clock: Clock;
  mic: MicCaptureHandle;
  config: MeetingSessionConfig;
  audioPlayer?: { enqueue(c: Uint8Array): void; stop(): void; msUntilIdle?(): number };
}

export class MeetingSession {
  id: string | null = null;
  private meta: MeetingMeta | null = null;
  private buffer = new TranscriptBuffer();
  private summaries: Summary[] = [];
  private aiExchanges: AiExchange[] = [];
  private listeners = new Map<EventName, Set<Handler>>();
  private scheduler: SummaryScheduler | null = null;
  private matcher: WakeWordMatcher | null = null;
  private qa: QaHandoff | null = null;
  private asrUnsub: Array<() => void> = [];
  private running = false;
  private router: AudioRouter;
  private status: 'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended' = 'idle';
  private reconnectAttempt = 0;
  private readonly BACKOFF_MS = [1000, 3000, 9000];
  /** True while we are intentionally tearing the ASR WS down (either
   *  during reconnect or meeting stop). Incoming 'closed' events are
   *  ignored in this window so our own stop() doesn't re-trigger the
   *  reconnect state machine and cause an infinite stop → closed →
   *  reconnect → stop loop the user reported as "always
   *  reconnecting." */
  private suppressClose = false;

  constructor(private deps: MeetingSessionDeps) {
    this.router = new AudioRouter({
      asr: (c) => deps.asr.sendAudio(c),
      e2e: (c) => deps.e2e.sendAudio(c),
    });
  }

  getRouter(): AudioRouter {
    return this.router;
  }

  /** Cancel an in-flight Q&A turn (user-initiated — ESC key or Cancel
   *  button). No-op if no Q&A is active. */
  cancelQa(): void {
    this.qa?.cancel();
  }

  isQaActive(): boolean {
    return this.qa?.isActive() ?? false;
  }

  on(event: EventName, cb: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  async start(title: string): Promise<void> {
    if (this.running) throw new Error('already running');
    this.running = true;
    const id = makeMeetingId();
    const startedAt = this.deps.clock.now();
    const meta: MeetingMeta = {
      schema_version: SCHEMA_VERSION,
      id,
      title,
      started_at: startedAt,
      ended_at: null,
      duration_sec: null,
      speaker_count: 0,
      tag: 'General',
      active_summary_index: -1,
    };
    this.id = id;
    this.meta = meta;
    await this.deps.persistence.createMeeting(meta);

    this.asrUnsub.push(this.deps.asr.on('final', (u) => this.handleUtterance(u as Utterance)));
    this.asrUnsub.push(
      this.deps.asr.on('partial', (u) => {
        const utt = u as Utterance;
        this.buffer.append(utt);
        // Trigger wake word on partials too — waiting for the definite
        // flag means an ~800 ms silence delay, which matches the user
        // report of "嘿 Nono nothing responds until I say it again."
        // The matcher debounces repeats per utterance.
        this.matcher?.observe(utt);
        // Drive the live ticker. It's the "current sentence being
        // spoken" display — it needs partials to show anything before
        // the 800 ms silence that flips an utterance to definite.
        this.emit('transcript', utt);
      }),
    );
    this.asrUnsub.push(this.deps.asr.on('error', this.onAsrError));
    // If the server silently closes the WS (inactivity timeout, server
    // restart, network blip) we used to do nothing — cpal kept firing
    // audio into a dead channel and the user saw transcripts just stop.
    // Treat close as a retryable network error so the reconnect state
    // machine kicks in.
    this.asrUnsub.push(
      this.deps.asr.on('closed', () => {
        if (this.suppressClose) return;
        this.onAsrError({ kind: 'network', message: 'ASR connection closed', retryable: true });
      }),
    );

    this.deps.mic.on('chunk', (c) => this.router.feed(c));
    this.deps.mic.on('rms', (r) => this.emit('orbState', { amplitude: r }));

    this.matcher = new WakeWordMatcher(this.deps.config.wakeWord, () => {
      void this.triggerQa();
    });

    this.scheduler = new SummaryScheduler({
      clock: this.deps.clock,
      buffer: this.buffer,
      llm: this.deps.llm,
      onSummary: (s) => {
        this.summaries.push(s);
        void this.deps.persistence.writeSummaries(id, this.summaries);
        this.emit('summary', s);
      },
    });

    this.qa = new QaHandoff({
      asr: this.deps.asr,
      e2e: this.deps.e2e,
      clock: this.deps.clock,
      buffer: this.buffer,
      summaries: () => this.summaries,
      router: this.router,
      // Pass the meeting id as the dialog id so Nono remembers prior
      // Q&A rounds across multiple wake-word events in the same
      // meeting. Volcano loads the last ~20 QA rounds from this
      // dialog_id on each new StartSession.
      dialogId: id,
      onOrbState: (s: OrbState) => this.emit('orbState', s),
      onExchange: (x) => {
        this.aiExchanges.push(x);
        void this.deps.persistence.writeAiExchanges(id, this.aiExchanges);
        this.emit('qa', x);
      },
      onTranscriptBridge: (u) => {
        // Q&A turns must land in the TranscriptBuffer just like raw
        // ASR finals. Otherwise SummaryScheduler.sinceLastSummary()
        // and buffer.all() (what the minutes renderer reads) never see
        // them — which is why the user reported "Nono 交互的内容和
        // transcript没有出现在end meeting之后的summary里面." The
        // tagged speakers ("User (to Nono)" / "SuperNono") let the
        // prompt tell the LLM these lines are the AI exchange, not
        // noise.
        this.buffer.append(u);
        void this.persistUtterance(u);
      },
      onAudioChunk: (c) => this.deps.audioPlayer?.enqueue(c),
      audioPlayerDrainMs: () => this.deps.audioPlayer?.msUntilIdle?.() ?? 0,
      onLiveQa: (live) => this.emit('qaLive', live),
    });

    // Order matters: start ASR before the mic so a failed handshake doesn't
    // leave cpal capturing (and firing 5 Hz "session not found" errors).
    try {
      await this.deps.asr.start({ lang: this.deps.config.lang, enableSpeakerId: true });
      await this.deps.mic.start();
    } catch (e) {
      this.running = false;
      for (const unsub of this.asrUnsub) unsub();
      this.asrUnsub = [];
      await this.deps.mic.stop().catch(() => {});
      await this.deps.asr.stop().catch(() => {});
      throw e;
    }
    this.setStatus('listening');
    this.scheduler.start();
  }

  private handleUtterance(u: Utterance) {
    this.buffer.append(u);
    void this.persistUtterance(u);
    this.matcher?.observe(u);
    this.emit('transcript', u);
  }

  private async persistUtterance(u: Utterance) {
    if (!this.id) return;
    await this.deps.persistence.appendUtterance(this.id, u);
  }

  private async triggerQa() {
    if (!this.qa) return;
    await this.qa.trigger();
    // Earlier versions did asr.stop() + asr.start() here to clear a
    // "stale VAD" state, but that raced with the 'closed' → retryable
    // error → tryReconnect path: the close fired after stop(), kicked
    // off a reconnect while our own start() was in flight, and the
    // session wedged in a "reconnecting" loop with "session not found"
    // Promise rejections from mic chunks hitting the dead session id.
    // The multi-turn Q&A flow already covers the user's actual
    // scenario (ASR only becomes the sink after the user stops
    // talking to Nono for 3 s — plenty of time for Volcano to settle).
  }

  private setStatus(next: typeof this.status) {
    if (this.status === next) return;
    this.status = next;
    this.emit('statusChange', next);
  }

  private onAsrError = (e: AsrError) => {
    if (!e.retryable) {
      this.setStatus('paused');
      this.emit('error', e);
      return;
    }
    this.tryReconnect();
  };

  private tryReconnect() {
    if (this.reconnectAttempt >= this.BACKOFF_MS.length) {
      this.setStatus('paused');
      this.reconnectAttempt = 0;
      return;
    }
    this.setStatus('reconnecting');
    const wait = this.BACKOFF_MS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.deps.clock.setTimeout(async () => {
      this.suppressClose = true;
      try {
        await this.deps.asr.stop();
        await this.deps.asr.start({ lang: this.deps.config.lang, enableSpeakerId: true });
        this.setStatus('listening');
        this.reconnectAttempt = 0;
      } catch {
        this.tryReconnect();
      } finally {
        this.suppressClose = false;
      }
    }, wait);
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    this.reconnectAttempt = 0;
    this.setStatus('reconnecting');
    try {
      await this.deps.asr.start({ lang: this.deps.config.lang, enableSpeakerId: true });
      this.setStatus('listening');
    } catch {
      this.setStatus('paused');
    }
  }

  async stop(): Promise<void> {
    if (!this.running || !this.meta || !this.id) return;
    this.running = false;
    this.scheduler?.stop();
    // Flush a final summary over any content that arrived after the
    // last scheduled tick — typically Q&A turns + the tail of
    // discussion just before End Meeting. Without this, short
    // meetings (or meetings that ended before the 5 min cadence
    // fired again) leave the "Summaries" section empty of everything
    // that happened post-Nono.
    await this.scheduler?.flush();
    this.suppressClose = true;
    for (const unsub of this.asrUnsub) unsub();
    this.asrUnsub = [];
    await this.deps.mic.stop();
    await this.deps.asr.stop();
    this.suppressClose = false;
    const endedAt = this.deps.clock.now();
    const duration = Math.floor((endedAt - this.meta.started_at) / 1000);

    const renderer = new MinutesRenderer(this.deps.llm);
    const md = await renderer.render({
      meta: { ...this.meta, ended_at: endedAt, duration_sec: duration },
      summaries: this.summaries,
      transcript: this.buffer.all(),
    });
    await this.deps.persistence.writeMinutes(this.id, md);
    const updated: MeetingMeta = {
      ...this.meta,
      ended_at: endedAt,
      duration_sec: duration,
      speaker_count: new Set(this.buffer.all().map((u) => u.speaker)).size,
    };
    await this.deps.persistence.writeMeta(this.id, updated);
    this.meta = updated;
  }
}
