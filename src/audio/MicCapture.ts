import type { MicCaptureHandle, Unsubscribe } from '../logic/adapters';

export interface MicCaptureDeps {
  contextFactory: () => AudioContext;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  workletUrl: string;
  buildNode?: (ctx: AudioContext) => AudioWorkletNode;
}

type Ev = 'chunk' | 'rms' | 'error';

export class MicCapture implements MicCaptureHandle {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private listeners = new Map<Ev, Set<(p: never) => void>>();

  constructor(private deps: MicCaptureDeps) {}

  async start(): Promise<void> {
    this.stream = await this.deps.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    this.ctx = this.deps.contextFactory();
    await this.ctx.audioWorklet.addModule(this.deps.workletUrl);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.deps.buildNode
      ? this.deps.buildNode(this.ctx)
      : new AudioWorkletNode(this.ctx, 'downsample-processor');
    this.node.port.onmessage = (ev) => {
      const msg = ev.data as { type: 'chunk' | 'rms'; buffer?: ArrayBuffer; value?: number };
      if (msg.type === 'chunk' && msg.buffer) {
        this.emit('chunk', new Uint8Array(msg.buffer));
      } else if (msg.type === 'rms' && typeof msg.value === 'number') {
        this.emit('rms', msg.value);
      }
    };
    source.connect(this.node);
  }

  async stop(): Promise<void> {
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
    this.ctx = null;
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
