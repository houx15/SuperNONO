import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VolcanoAsrClient } from './VolcanoAsrClient';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from '@tauri-apps/api/core';
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe('VolcanoAsrClient IPC contract', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });

  it('asr_start payload has the exact shape Rust accepts', async () => {
    const c = new VolcanoAsrClient('mtg_abc', 'my_app_id', 'my_access_token');
    await c.start({ lang: 'zh', enableSpeakerId: true });

    expect(invokeMock).toHaveBeenCalledWith('asr_start', {
      sessionId: 'mtg_abc',
      appId: 'my_app_id',
      accessKey: 'my_access_token',
      params: { lang: 'zh', enableSpeakerId: true },
    });
    // Critically: params.enableSpeakerId must be camelCase. If this ever
    // changes to snake_case, the matching Rust contract test in
    // volcano_ws.rs (asr_start_params_accepts_ts_camelcase_payload) will
    // also need to change. These two tests together lock the contract.
  });

  it('asr_send_audio payload uses pcmChunk as an array of bytes', async () => {
    const c = new VolcanoAsrClient('mtg', 'id', 'key');
    c.sendAudio(new Uint8Array([1, 2, 3, 4]));
    // fire-and-forget via void; give the microtask queue a tick
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('asr_send_audio', {
      sessionId: 'mtg',
      pcmChunk: [1, 2, 3, 4],
    });
  });

  it('asr_stop payload is { sessionId }', async () => {
    const c = new VolcanoAsrClient('mtg', 'id', 'key');
    await c.stop();
    expect(invokeMock).toHaveBeenCalledWith('asr_stop', { sessionId: 'mtg' });
  });

  it('asr_test_credentials payload is { appId, accessKey }', async () => {
    invokeMock.mockResolvedValue({ ok: true, reason: null });
    const c = new VolcanoAsrClient('mtg', 'a', 'b');
    await c.testCredentials('inline_app', 'inline_key');
    expect(invokeMock).toHaveBeenCalledWith('asr_test_credentials', {
      appId: 'inline_app',
      accessKey: 'inline_key',
    });
  });
});
