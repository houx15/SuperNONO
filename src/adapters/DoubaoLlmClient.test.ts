import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoubaoLlmClient } from './DoubaoLlmClient';

describe('DoubaoLlmClient.complete', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to Ark with Bearer auth + default model', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi there' } }] }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const c = new DoubaoLlmClient('sk-key');
    const resp = await c.complete({ prompt: 'hello' });

    expect(resp.text).toBe('hi there');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer sk-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('doubao-1-5-pro-256k');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.stream).toBe(false);
  });

  it('surfaces 401 as auth error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('bad');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('surfaces 429 as rate_limit retryable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'throttled',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('surfaces 5xx as server retryable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'down',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
    });
  });

  it('surfaces network failure', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('throws if API key null (not configured)', async () => {
    const c = new DoubaoLlmClient(null);
    await expect(c.complete({ prompt: 'x' })).rejects.toThrow('Doubao API key not configured');
  });
});

describe('DoubaoLlmClient.testCredentials', () => {
  afterEach(() => {
    /* cleanup */
  });
  it('returns ok on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-valid');
    expect(r.ok).toBe(true);
  });
  it('returns !ok with reason on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-bad');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/401|auth|key/i);
  });
  it('returns !ok with reason on network fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fail')) as unknown as typeof fetch;
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe('DoubaoLlmClient.stream', () => {
  it('yields delta chunks from SSE', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const encoded = new TextEncoder().encode(body);
    const reader = {
      _done: false,
      async read() {
        if (this._done) return { done: true, value: undefined };
        this._done = true;
        return { done: false, value: encoded };
      },
      releaseLock() {},
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    }) as unknown as typeof fetch;

    const c = new DoubaoLlmClient('k');
    const out: string[] = [];
    for await (const chunk of c.stream({ prompt: 'hi' })) {
      out.push(chunk.delta);
    }
    expect(out.join('')).toBe('Hello');
  });
});
