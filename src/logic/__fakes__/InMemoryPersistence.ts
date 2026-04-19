import type { Persistence } from '../adapters';
import type { MeetingMeta, Utterance, Summary, AiExchange, FullMeeting } from '../types';

interface State {
  meta: MeetingMeta;
  transcript: Utterance[];
  summaries: Summary[];
  aiExchanges: AiExchange[];
  minutesMd: string | null;
}

export class InMemoryPersistence implements Persistence {
  private meetings = new Map<string, State>();

  async createMeeting(meta: MeetingMeta) {
    this.meetings.set(meta.id, {
      meta,
      transcript: [],
      summaries: [],
      aiExchanges: [],
      minutesMd: null,
    });
  }

  async appendUtterance(id: string, u: Utterance) {
    this.get(id).transcript.push(u);
  }

  async writeSummaries(id: string, s: Summary[]) {
    this.get(id).summaries = [...s];
  }

  async writeMeta(id: string, m: MeetingMeta) {
    this.get(id).meta = m;
  }

  async writeMinutes(id: string, md: string) {
    this.get(id).minutesMd = md;
  }

  async writeAiExchanges(id: string, ex: AiExchange[]) {
    this.get(id).aiExchanges = [...ex];
  }

  async listMeetings(): Promise<MeetingMeta[]> {
    return [...this.meetings.values()].map((s) => s.meta);
  }

  async readMeeting(id: string): Promise<FullMeeting> {
    const s = this.get(id);
    return {
      meta: s.meta,
      summaries: [...s.summaries],
      transcript: [...s.transcript],
      aiExchanges: [...s.aiExchanges],
      minutesMd: s.minutesMd,
    };
  }

  async exportMinutes(_id: string, _destPath: string) {
    /* no-op for tests */
  }

  private get(id: string): State {
    const s = this.meetings.get(id);
    if (!s) throw new Error(`no meeting ${id}`);
    return s;
  }
}
