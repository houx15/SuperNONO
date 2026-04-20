import type { AsrClient, E2eClient, LlmClient, MicCaptureHandle, Persistence } from './adapters';
import type { Clock } from './clock';
import type { AiExchange, MeetingMeta, OrbState, Summary, Utterance } from './types';
import { SCHEMA_VERSION, makeMeetingId } from './types';
import { TranscriptBuffer } from './TranscriptBuffer';
import { WakeWordMatcher } from './WakeWordMatcher';
import { SummaryScheduler } from './SummaryScheduler';
import { QaHandoff } from './QaHandoff';
import { AudioRouter } from './AudioRouter';
import { MinutesRenderer } from './MinutesRenderer';

type EventName = 'transcript' | 'summary' | 'qa' | 'orbState' | 'error' | 'statusChange';
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

  constructor(private deps: MeetingSessionDeps) {
    this.router = new AudioRouter({
      asr: (c) => deps.asr.sendAudio(c),
      e2e: (c) => deps.e2e.sendAudio(c),
    });
  }

  getRouter(): AudioRouter {
    return this.router;
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
    this.asrUnsub.push(this.deps.asr.on('partial', (u) => this.buffer.append(u as Utterance)));

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
      onOrbState: (s: OrbState) => this.emit('orbState', s),
      onExchange: (x) => {
        this.aiExchanges.push(x);
        void this.deps.persistence.writeAiExchanges(id, this.aiExchanges);
        this.emit('qa', x);
      },
      onTranscriptBridge: (u) => void this.persistUtterance(u),
    });

    await this.deps.mic.start();
    await this.deps.asr.start({ lang: this.deps.config.lang, enableSpeakerId: true });
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
  }

  async stop(): Promise<void> {
    if (!this.running || !this.meta || !this.id) return;
    this.running = false;
    this.scheduler?.stop();
    for (const unsub of this.asrUnsub) unsub();
    this.asrUnsub = [];
    await this.deps.mic.stop();
    await this.deps.asr.stop();
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
