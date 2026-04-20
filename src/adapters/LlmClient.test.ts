import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmClient } from './LlmClient';
import type { LlmConfig } from '../logic/adapters';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const CFG: LlmConfig = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-2-0-code-preview-260215',
  apiKey: 'ark-xxx',
  sdkShape: 'openai',
};

describe('LlmClient.complete', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('invokes llm_complete with full config + prompt, returns text', async () => {
    invokeMock.mockResolvedValue({ text: 'hi there' });
    const c = new LlmClient(CFG);
    const resp = await c.complete({ prompt: 'hello' });
    expect(resp.text).toBe('hi there');
    expect(invokeMock).toHaveBeenCalledWith('llm_complete', {
      baseUrl: CFG.baseUrl,
      model: CFG.model,
      apiKey: CFG.apiKey,
      prompt: 'hello',
      sdkShape: 'openai',
    });
  });

  it('surfaces HTTP 401 as auth error', async () => {
    invokeMock.mockRejectedValue('HTTP 401 Unauthorized: bad key');
    const c = new LlmClient(CFG);
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('surfaces HTTP 429 as rate_limit retryable', async () => {
    invokeMock.mockRejectedValue('HTTP 429 Too Many Requests: throttled');
    const c = new LlmClient(CFG);
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('surfaces HTTP 503 as server retryable', async () => {
    invokeMock.mockRejectedValue('HTTP 503 Service Unavailable: down');
    const c = new LlmClient(CFG);
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
    });
  });

  it('surfaces network failure', async () => {
    invokeMock.mockRejectedValue('network: connection refused');
    const c = new LlmClient(CFG);
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('throws if not configured', async () => {
    const c = new LlmClient(null);
    await expect(c.complete({ prompt: 'x' })).rejects.toThrow('LLM not configured');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('throws if any config field is empty', async () => {
    const c = new LlmClient({ ...CFG, apiKey: '' });
    await expect(c.complete({ prompt: 'x' })).rejects.toThrow('LLM not configured');
  });

  it('passes sdkShape through to invoke', async () => {
    invokeMock.mockResolvedValue({ text: 'ok' });
    const c = new LlmClient({ ...CFG, sdkShape: 'anthropic' });
    await c.complete({ prompt: 'hi' });
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ sdkShape: 'anthropic' });
  });
});

describe('LlmClient.testCredentials', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('forwards the full config bag', async () => {
    invokeMock.mockResolvedValue({ ok: true, reason: null });
    const c = new LlmClient(null);
    const r = await c.testCredentials(CFG);
    expect(r.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('llm_test_credentials', {
      baseUrl: CFG.baseUrl,
      model: CFG.model,
      apiKey: CFG.apiKey,
      sdkShape: 'openai',
    });
  });

  it('surfaces Rust failure result unchanged', async () => {
    invokeMock.mockResolvedValue({ ok: false, reason: 'HTTP 404: model not found' });
    const c = new LlmClient(null);
    const r = await c.testCredentials(CFG);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/model not found/);
  });
});

describe('LlmClient.stream', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('yields a single chunk backed by complete()', async () => {
    invokeMock.mockResolvedValue({ text: 'Hello' });
    const c = new LlmClient(CFG);
    const out: string[] = [];
    for await (const chunk of c.stream({ prompt: 'hi' })) {
      out.push(chunk.delta);
    }
    expect(out.join('')).toBe('Hello');
  });
});
