import type { LlmClient, LlmConfig, LlmReq, LlmResp, LlmChunk } from '../adapters';
import type { TestResult } from '../types';

export interface FakeLlmRule {
  match: (prompt: string) => boolean;
  text: string;
}

export class FakeLlmClient implements LlmClient {
  public testResult: TestResult = { ok: true };
  constructor(private rules: FakeLlmRule[]) {}

  async complete(req: LlmReq): Promise<LlmResp> {
    for (const r of this.rules) if (r.match(req.prompt)) return { text: r.text };
    throw new Error('FakeLlmClient: no rule matched prompt:\n' + req.prompt.slice(0, 200));
  }

  async *stream(req: LlmReq): AsyncIterable<LlmChunk> {
    const resp = await this.complete(req);
    for (const ch of resp.text) yield { delta: ch };
  }

  async testCredentials(_cfg: LlmConfig) {
    return this.testResult;
  }
}
