import { describe, it, expect } from 'vitest';
import { HistoryIndex } from './HistoryIndex';
import type { MeetingMeta, FullMeeting } from './types';

function meta(id: string, ended: number | null, startedAt = 0): MeetingMeta {
  return {
    schema_version: 1,
    id,
    title: id,
    started_at: startedAt,
    ended_at: ended,
    duration_sec: ended,
    speaker_count: 1,
    tag: 'General',
    active_summary_index: -1,
  };
}

class InMemP {
  meetings = new Map<string, FullMeeting>();
  async listMeetings() {
    return [...this.meetings.values()].map((m) => m.meta);
  }
  async readMeeting(id: string) {
    return this.meetings.get(id)!;
  }
}

describe('HistoryIndex', () => {
  it('lists meetings most-recent first', async () => {
    const p = new InMemP();
    p.meetings.set('a', {
      meta: meta('a', 3000, 3000),
      summaries: [],
      transcript: [],
      aiExchanges: [],
      minutesMd: null,
    });
    p.meetings.set('b', {
      meta: meta('b', 1000, 1000),
      summaries: [],
      transcript: [],
      aiExchanges: [],
      minutesMd: null,
    });
    const h = new HistoryIndex(p as never);
    const list = await h.list();
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('finds crashed meetings (missing ended_at)', async () => {
    const p = new InMemP();
    p.meetings.set('clean', {
      meta: meta('clean', 1000),
      summaries: [],
      transcript: [],
      aiExchanges: [],
      minutesMd: null,
    });
    p.meetings.set('crashed', {
      meta: meta('crashed', null),
      summaries: [],
      transcript: [],
      aiExchanges: [],
      minutesMd: null,
    });
    const h = new HistoryIndex(p as never);
    const c = await h.crashRecoveryScan();
    expect(c.map((m) => m.id)).toEqual(['crashed']);
  });
});
