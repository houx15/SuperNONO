import { invoke } from '@tauri-apps/api/core';
import type {
  LlmClient as LlmClientIface,
  LlmConfig,
  LlmReq,
  LlmResp,
  LlmChunk,
} from '../logic/adapters';
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

export class LlmClient implements LlmClientIface {
  constructor(private config: LlmConfig | null) {}

  async complete(req: LlmReq): Promise<LlmResp> {
    const cfg = this.config;
    if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      throw new Error('LLM not configured');
    }
    try {
      const resp = await invoke<{ text: string }>('llm_complete', {
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey: cfg.apiKey,
        prompt: req.prompt,
        sdkShape: cfg.sdkShape,
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
    // Streaming SSE not routed through Rust yet; yield a single chunk backed
    // by `complete()`. Summaries + minutes in M2 only use `complete`.
    const resp = await this.complete(req);
    yield { delta: resp.text };
  }

  async testCredentials(config: LlmConfig): Promise<TestResult> {
    return await invoke<TestResult>('llm_test_credentials', {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      sdkShape: config.sdkShape,
    });
  }
}
