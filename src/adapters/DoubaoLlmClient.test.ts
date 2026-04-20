import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoubaoLlmClient } from './DoubaoLlmClient';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe('DoubaoLlmClient.complete', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('invokes doubao_complete with apiKey + prompt, returns text', async () => {
    invokeMock.mockResolvedValue({ text: 'hi there' });
    const c = new DoubaoLlmClient('sk-key');
    const resp = await c.complete({ prompt: 'hello' });
    expect(resp.text).toBe('hi there');
    expect(invokeMock).toHaveBeenCalledWith('doubao_complete', {
      apiKey: 'sk-key',
      prompt: 'hello',
    });
  });

  it('surfaces HTTP 401 from Rust as auth error', async () => {
    invokeMock.mockRejectedValue('HTTP 401 Unauthorized: bad key');
    const c = new DoubaoLlmClient('bad');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('surfaces HTTP 429 as rate_limit retryable', async () => {
    invokeMock.mockRejectedValue('HTTP 429 Too Many Requests: throttled');
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('surfaces HTTP 503 as server retryable', async () => {
    invokeMock.mockRejectedValue('HTTP 503 Service Unavailable: down');
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
    });
  });

  it('surfaces network failure', async () => {
    invokeMock.mockRejectedValue('network: connection refused');
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('throws if API key null (not configured)', async () => {
    const c = new DoubaoLlmClient(null);
    await expect(c.complete({ prompt: 'x' })).rejects.toThrow('Doubao API key not configured');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('DoubaoLlmClient.testCredentials', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('returns ok on Rust OK result', async () => {
    invokeMock.mockResolvedValue({ ok: true, reason: null });
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-valid');
    expect(r.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('doubao_test_credentials', { apiKey: 'sk-valid' });
  });

  it('returns !ok with reason on Rust failure result', async () => {
    invokeMock.mockResolvedValue({ ok: false, reason: 'HTTP 401' });
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-bad');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/401/);
  });
});

describe('DoubaoLlmClient.stream', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('yields a single chunk backed by complete()', async () => {
    invokeMock.mockResolvedValue({ text: 'Hello' });
    const c = new DoubaoLlmClient('k');
    const out: string[] = [];
    for await (const chunk of c.stream({ prompt: 'hi' })) {
      out.push(chunk.delta);
    }
    expect(out.join('')).toBe('Hello');
  });
});
