import type { LlmClient, LlmReq, LlmResp, LlmChunk } from '../logic/adapters';
import type { TestResult, AsrError } from '../logic/types';

const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const DEFAULT_MODEL = 'doubao-1-5-pro-256k';

function classifyHttp(status: number): AsrError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'protocol';
}

function retryableKind(k: AsrError['kind']): boolean {
  return k === 'rate_limit' || k === 'server' || k === 'network';
}

export class DoubaoLlmClient implements LlmClient {
  constructor(private apiKey: string | null) {}

  async complete(req: LlmReq): Promise<LlmResp> {
    if (!this.apiKey) throw new Error('Doubao API key not configured');
    let resp: Response;
    try {
      resp = await fetch(ARK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [{ role: 'user', content: req.prompt }],
          stream: false,
          max_tokens: 1500,
        }),
      });
    } catch (e) {
      const err: AsrError = { kind: 'network', message: (e as Error).message, retryable: true };
      throw err;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const kind = classifyHttp(resp.status);
      const err: AsrError = {
        kind,
        message: `HTTP ${resp.status}: ${body.slice(0, 200)}`,
        retryable: retryableKind(kind),
      };
      throw err;
    }
    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? '' };
  }

  async *stream(req: LlmReq): AsyncIterable<LlmChunk> {
    if (!this.apiKey) throw new Error('Doubao API key not configured');
    const resp = await fetch(ARK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: req.prompt }],
        stream: true,
        max_tokens: 1500,
      }),
    });
    if (!resp.ok || !resp.body) {
      const kind = resp.ok ? 'protocol' : classifyHttp(resp.status);
      const err: AsrError = {
        kind,
        message: `HTTP ${resp.status}`,
        retryable: retryableKind(kind),
      };
      throw err;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) yield { delta };
          } catch {
            /* ignore malformed SSE line */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async testCredentials(apiKey: string): Promise<TestResult> {
    try {
      const resp = await fetch(ARK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      if (resp.ok) return { ok: true };
      return { ok: false, reason: `HTTP ${resp.status}` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
}
