import type {
  Utterance,
  Summary,
  MeetingMeta,
  AiExchange,
  FullMeeting,
  TestResult,
  AsrError,
  E2eError,
} from './types';

export type Unsubscribe = () => void;

export interface AsrOpts {
  lang: 'zh' | 'en';
  enableSpeakerId: boolean;
}

export interface AsrClient {
  start(opts: AsrOpts): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  stop(): Promise<void>;
  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
}

export interface E2eOpen {
  systemPrompt: string;
  voice: string;
}

export interface E2eClient {
  open(opts: E2eOpen): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  on(event: 'question_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'answer_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'audio', cb: (p: Uint8Array) => void): Unsubscribe;
  on(event: 'turn_end', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: E2eError) => void): Unsubscribe;
  close(): Promise<void>;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
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

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  sdkShape: 'openai' | 'anthropic';
}

export interface LlmClient {
  complete(req: LlmReq): Promise<LlmResp>;
  stream(req: LlmReq): AsyncIterable<LlmChunk>;
  testCredentials(config: LlmConfig): Promise<TestResult>;
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

export interface MicCaptureHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'chunk', cb: (chunk: Uint8Array) => void): Unsubscribe;
  on(event: 'rms', cb: (rms: number) => void): Unsubscribe;
  on(event: 'error', cb: (err: Error) => void): Unsubscribe;
}
