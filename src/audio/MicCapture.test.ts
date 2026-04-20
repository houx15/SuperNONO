import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicCapture } from './MicCapture';

type EventCb<T> = (e: { payload: T }) => void;

const listenHandlers = new Map<string, EventCb<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: EventCb<unknown>) => {
    listenHandlers.set(name, cb);
    return Promise.resolve(() => {
      listenHandlers.delete(name);
    });
  }),
}));

import { invoke } from '@tauri-apps/api/core';
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  listenHandlers.clear();
  invokeMock.mockClear();
});

describe('MicCapture', () => {
  it('invokes mic_start on start() and mic_stop on stop()', async () => {
    const m = new MicCapture();
    await m.start();
    expect(invokeMock).toHaveBeenCalledWith('mic_start');
    await m.stop();
    expect(invokeMock).toHaveBeenCalledWith('mic_stop');
  });

  it('routes mic://chunk event to chunk listener as Uint8Array', async () => {
    const m = new MicCapture();
    await m.start();
    const chunks: Uint8Array[] = [];
    m.on('chunk', (c) => chunks.push(c));
    const handler = listenHandlers.get('mic://chunk') as EventCb<number[]>;
    handler({ payload: [1, 2, 3, 4] });
    expect(chunks.length).toBe(1);
    expect(Array.from(chunks[0])).toEqual([1, 2, 3, 4]);
  });

  it('routes mic://rms event to rms listener', async () => {
    const m = new MicCapture();
    await m.start();
    const levels: number[] = [];
    m.on('rms', (r) => levels.push(r));
    const handler = listenHandlers.get('mic://rms') as EventCb<number>;
    handler({ payload: 0.42 });
    handler({ payload: 0.7 });
    expect(levels).toEqual([0.42, 0.7]);
  });

  it('routes mic://error event to error listener as Error', async () => {
    const m = new MicCapture();
    await m.start();
    const errors: Error[] = [];
    m.on('error', (e) => errors.push(e));
    const handler = listenHandlers.get('mic://error') as EventCb<string>;
    handler({ payload: 'no default input device' });
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('no default input device');
  });

  it('unsubscribes listen handlers on stop()', async () => {
    const m = new MicCapture();
    await m.start();
    expect(listenHandlers.size).toBe(3);
    await m.stop();
    expect(listenHandlers.size).toBe(0);
  });
});
