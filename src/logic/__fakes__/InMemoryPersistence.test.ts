import { describe, it, expect } from 'vitest';
import { InMemoryPersistence } from './InMemoryPersistence';
import type { MeetingMeta, Utterance } from '../types';

const meta: MeetingMeta = {
  schema_version: 1,
  id: 'mtg_abcd',
  title: 'X',
  started_at: 1,
  ended_at: null,
  duration_sec: null,
  speaker_count: 0,
  tag: 'General',
  active_summary_index: -1,
};

describe('InMemoryPersistence', () => {
  it('stores and reads a meeting end-to-end', async () => {
    const p = new InMemoryPersistence();
    await p.createMeeting(meta);
    const u: Utterance = { t: 10, speaker: 'S1', text: 'hi', final: true };
    await p.appendUtterance(meta.id, u);
    await p.writeSummaries(meta.id, []);
    await p.writeMeta(meta.id, { ...meta, ended_at: 100, duration_sec: 100 });
    await p.writeMinutes(meta.id, '# minutes');
    await p.writeAiExchanges(meta.id, []);
    const full = await p.readMeeting(meta.id);
    expect(full.meta.ended_at).toBe(100);
    expect(full.transcript).toEqual([u]);
    expect(full.minutesMd).toBe('# minutes');
  });

  it('listMeetings returns all created meetings', async () => {
    const p = new InMemoryPersistence();
    await p.createMeeting(meta);
    await p.createMeeting({ ...meta, id: 'mtg_xx', started_at: 5 });
    const all = await p.listMeetings();
    expect(all.length).toBe(2);
  });
});
