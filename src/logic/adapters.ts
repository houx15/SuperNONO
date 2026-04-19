import type { Utterance, Summary, MeetingMeta, AiExchange, FullMeeting, TestResult } from './types';

export type Unsubscribe = () => void;

export interface AsrOpts {
  lang: 'zh' | 'en';
  enableSpeakerId: boolean;
}

export interface AsrClient {
  start(opts: AsrOpts): Promise<void>;
  stop(): Promise<void>;
  on(
    event: 'partial' | 'final' | 'error' | 'closed',
    cb: (payload: Utterance | Error) => void,
  ): Unsubscribe;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
}

export interface E2eOpen {
  systemPrompt: string;
  voice: string;
}

export interface E2eClient {
  open(opts: E2eOpen): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  on(
    event: 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error',
    cb: (payload: unknown) => void,
  ): Unsubscribe;
  close(): Promise<void>;
  testCredentials(apiKey: string): Promise<TestResult>;
}

export interface LlmReq {
  prompt: string;
}
export interface LlmResp {
  text: string;
}
export interface LlmChunk {
  delta: string;
}

export interface LlmClient {
  complete(req: LlmReq): Promise<LlmResp>;
  stream(req: LlmReq): AsyncIterable<LlmChunk>;
  testCredentials(apiKey: string): Promise<TestResult>;
}

export interface Persistence {
  createMeeting(meta: MeetingMeta): Promise<void>;
  appendUtterance(mtgId: string, u: Utterance): Promise<void>;
  writeSummaries(mtgId: string, summaries: Summary[]): Promise<void>;
  writeMeta(mtgId: string, meta: MeetingMeta): Promise<void>;
  writeMinutes(mtgId: string, md: string): Promise<void>;
  writeAiExchanges(mtgId: string, exchanges: AiExchange[]): Promise<void>;
  listMeetings(): Promise<MeetingMeta[]>;
  readMeeting(mtgId: string): Promise<FullMeeting>;
  exportMinutes(mtgId: string, destPath: string): Promise<void>;
}
