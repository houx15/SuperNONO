import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MicCaptureHandle, Unsubscribe } from '../logic/adapters';

type Ev = 'chunk' | 'rms' | 'error';

/**
 * Subscribes to native cpal events emitted from Rust. The browser mic APIs
 * (`navigator.mediaDevices.getUserMedia`) are not available in Tauri 2's
 * WKWebView on macOS, so mic capture runs in Rust via cpal and sends chunks
 * up via Tauri events. This class mirrors the previous AudioWorklet-based
 * implementation's external contract.
 */
export class MicCapture implements MicCaptureHandle {
  private unlistens: UnlistenFn[] = [];
  private listeners = new Map<Ev, Set<(p: never) => void>>();

  async start(): Promise<void> {
    this.unlistens.push(
      await listen<number[]>('mic://chunk', (e) => {
        this.emit('chunk', new Uint8Array(e.payload));
      }),
    );
    this.unlistens.push(
      await listen<number>('mic://rms', (e) => {
        this.emit('rms', e.payload);
      }),
    );
    this.unlistens.push(
      await listen<string>('mic://error', (e) => {
        this.emit('error', new Error(e.payload));
      }),
    );
    await invoke('mic_start');
  }

  async stop(): Promise<void> {
    try {
      await invoke('mic_stop');
    } catch {
      /* best effort */
    }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: 'chunk', cb: (c: Uint8Array) => void): Unsubscribe;
  on(event: 'rms', cb: (r: number) => void): Unsubscribe;
  on(event: 'error', cb: (e: Error) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
