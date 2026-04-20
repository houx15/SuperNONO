export const SCHEMA_VERSION = 1;

export interface Utterance {
  t: number; // ms since epoch
  speaker: string; // "Speaker 1", "User (to Nono)", "SuperNono", etc.
  text: string;
  final: boolean;
}

export interface Summary {
  time: string; // e.g. "14:00 — 14:06"
  topic: string;
  text: string;
  speakers: string[] | null;
  state: 'active' | 'done';
  startedAt: number; // ms
  endedAt: number | null;
}

export interface MeetingMeta {
  schema_version: number;
  id: string; // mtg_xxxxxxxx
  title: string;
  started_at: number;
  ended_at: number | null;
  duration_sec: number | null;
  speaker_count: number;
  tag: string;
  active_summary_index: number;
}

export interface AiExchange {
  t: number;
  question: string;
  answer: string;
  cites: string[]; // empty in MVP
}

export interface FullMeeting {
  meta: MeetingMeta;
  summaries: Summary[];
  transcript: Utterance[];
  aiExchanges: AiExchange[];
  minutesMd: string | null;
}

export type TestResult = { ok: boolean; reason?: string };

export type OrbState = 'idle' | 'activated' | 'thinking' | 'speaking';

export function isFinalUtterance(u: Utterance): boolean {
  return u.final === true;
}

export function makeMeetingId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `mtg_${hex}`;
}

export type AsrErrorKind = 'auth' | 'network' | 'rate_limit' | 'server' | 'protocol';

export interface AsrError {
  kind: AsrErrorKind;
  message: string;
  retryable: boolean;
}

export type E2eErrorKind = AsrErrorKind;
export type E2eError = AsrError;
