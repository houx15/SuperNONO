import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoubaoE2eClient } from './DoubaoE2eClient';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from '@tauri-apps/api/core';
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe('DoubaoE2eClient IPC contract', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });

  it('e2e_open payload has the exact shape Rust accepts', async () => {
    const c = new DoubaoE2eClient('mtg', 'my_app_id', 'my_access_token');
    await c.open({ systemPrompt: 'be nice', voice: 'vv', dialogId: 'mtg_abc' });
    expect(invokeMock).toHaveBeenCalledWith('e2e_open', {
      sessionId: 'mtg',
      appId: 'my_app_id',
      accessKey: 'my_access_token',
      // NOTE: inside `opts`, keys are snake_case (system_prompt,
      // dialog_id) — different from asr_start's camelCase params.
      // Matching Rust contract test in e2e_ws.rs locks this in.
      opts: { system_prompt: 'be nice', voice: 'vv', dialog_id: 'mtg_abc' },
    });
  });

  it('e2e_send_audio payload', async () => {
    const c = new DoubaoE2eClient('mtg', 'id', 'key');
    c.sendAudio(new Uint8Array([9, 8, 7]));
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('e2e_send_audio', {
      sessionId: 'mtg',
      pcmChunk: [9, 8, 7],
    });
  });

  it('e2e_close payload', async () => {
    const c = new DoubaoE2eClient('mtg', 'id', 'key');
    await c.close();
    expect(invokeMock).toHaveBeenCalledWith('e2e_close', { sessionId: 'mtg' });
  });

  it('e2e_test_credentials payload is { appId, accessKey }', async () => {
    invokeMock.mockResolvedValue({ ok: true, reason: null });
    const c = new DoubaoE2eClient('mtg', 'a', 'b');
    await c.testCredentials('inline_app', 'inline_key');
    expect(invokeMock).toHaveBeenCalledWith('e2e_test_credentials', {
      appId: 'inline_app',
      accessKey: 'inline_key',
    });
  });
});
