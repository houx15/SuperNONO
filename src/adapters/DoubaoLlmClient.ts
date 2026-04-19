import type { LlmClient, LlmReq, LlmResp, LlmChunk } from '../logic/adapters';
import type { TestResult } from '../logic/types';

export class DoubaoLlmClient implements LlmClient {
  constructor(private apiKey: string | null) {
    // apiKey retained for M2 implementation
    void this.apiKey;
  }

  async complete(_req: LlmReq): Promise<LlmResp> {
    throw new Error('DoubaoLlmClient: real HTTP call implemented in M2');
  }

  // eslint-disable-next-line require-yield
  async *stream(_req: LlmReq): AsyncIterable<LlmChunk> {
    throw new Error('DoubaoLlmClient.stream: real HTTP call implemented in M2');
  }

  async testCredentials(_apiKey: string): Promise<TestResult> {
    return { ok: false, reason: 'Not implemented until M2' };
  }
}
