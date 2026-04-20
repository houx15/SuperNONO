import { invoke } from '@tauri-apps/api/core';
import type { Persistence } from '../logic/adapters';
import type { MeetingMeta, Summary, Utterance, AiExchange, FullMeeting } from '../logic/types';
import { SCHEMA_VERSION } from '../logic/types';

export const fsAdapter: Persistence = {
  async createMeeting(meta) {
    await invoke('meeting_create', { id: meta.id, metaJson: JSON.stringify(meta) });
  },
  async appendUtterance(mtgId, u) {
    const line = JSON.stringify({ schema_version: SCHEMA_VERSION, ...u });
    await invoke('meeting_append_utterance', { id: mtgId, lineJson: line });
  },
  async writeSummaries(mtgId, summaries) {
    const json = JSON.stringify({ schema_version: SCHEMA_VERSION, summaries });
    await invoke('meeting_write_summaries', { id: mtgId, json });
  },
  async writeMeta(mtgId, meta) {
    await invoke('meeting_write_meta', { id: mtgId, metaJson: JSON.stringify(meta) });
  },
  async writeMinutes(mtgId, md) {
    await invoke('meeting_write_minutes', { id: mtgId, md });
  },
  async writeAiExchanges(mtgId, exchanges) {
    const json = JSON.stringify({ schema_version: SCHEMA_VERSION, exchanges });
    await invoke('meeting_write_ai_exchanges', { id: mtgId, json });
  },
  async listMeetings(): Promise<MeetingMeta[]> {
    const raw = await invoke<unknown[]>('meeting_list');
    return raw.map((v) => v as MeetingMeta);
  },
  async readMeeting(mtgId): Promise<FullMeeting> {
    const p = await invoke<{
      meta: MeetingMeta;
      summaries: { summaries: Summary[] };
      transcript: Utterance[];
      ai_exchanges: { exchanges: AiExchange[] };
      minutes_md: string | null;
    }>('meeting_read', { id: mtgId });
    return {
      meta: p.meta,
      summaries: p.summaries?.summaries ?? [],
      transcript: p.transcript,
      aiExchanges: p.ai_exchanges?.exchanges ?? [],
      minutesMd: p.minutes_md,
    };
  },
  async exportMinutes(mtgId, destPath) {
    await invoke('meeting_export_md', { id: mtgId, destPath });
  },
  async deleteMeeting(mtgId: string) {
    await invoke('meeting_delete', { id: mtgId });
  },
};
