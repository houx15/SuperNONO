import type { MeetingMeta, FullMeeting } from './types';

export interface PersistenceRead {
  listMeetings(): Promise<MeetingMeta[]>;
  readMeeting(id: string): Promise<FullMeeting>;
}

export class HistoryIndex {
  constructor(private p: PersistenceRead) {}

  async list(): Promise<MeetingMeta[]> {
    const all = await this.p.listMeetings();
    return all.sort((a, b) => b.started_at - a.started_at);
  }

  async open(id: string): Promise<FullMeeting> {
    return this.p.readMeeting(id);
  }

  async crashRecoveryScan(): Promise<MeetingMeta[]> {
    const all = await this.p.listMeetings();
    return all.filter((m) => m.ended_at === null);
  }
}
