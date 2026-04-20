import { invoke } from '@tauri-apps/api/core';
import type { LlmClient, LlmReq, LlmResp, LlmChunk } from '../logic/adapters';
import type { TestResult, AsrError } from '../logic/types';

function classifyMessage(msg: string): AsrError['kind'] {
  if (msg.includes('401') || msg.includes('403')) return 'auth';
  if (msg.includes('429')) return 'rate_limit';
  if (msg.startsWith('HTTP 5')) return 'server';
  if (msg.startsWith('network:') || msg.includes('timeout')) return 'network';
  return 'protocol';
}

function retryableKind(k: AsrError['kind']): boolean {
  return k === 'rate_limit' || k === 'server' || k === 'network';
}

export class DoubaoLlmClient implements LlmClient {
  constructor(private apiKey: string | null) {}

  async complete(req: LlmReq): Promise<LlmResp> {
    if (!this.apiKey) throw new Error('Doubao API key not configured');
    try {
      const resp = await invoke<{ text: string }>('doubao_complete', {
        apiKey: this.apiKey,
        prompt: req.prompt,
      });
      return { text: resp.text };
    } catch (e) {
      const msg = typeof e === 'string' ? e : ((e as Error).message ?? String(e));
      const kind = classifyMessage(msg);
      const err: AsrError = { kind, message: msg, retryable: retryableKind(kind) };
      throw err;
    }
  }

  async *stream(req: LlmReq): AsyncIterable<LlmChunk> {
    // Streaming SSE is not routed through Rust in M2 — summaries/minutes use
    // `complete()`. Keep the contract satisfied by yielding a single chunk.
    const resp = await this.complete(req);
    yield { delta: resp.text };
  }

  async testCredentials(apiKey: string): Promise<TestResult> {
    return await invoke<TestResult>('doubao_test_credentials', { apiKey });
  }
}
