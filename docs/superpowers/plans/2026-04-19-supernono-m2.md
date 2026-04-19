# SuperNono M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M1 fake-drivable demo into a real product — live Volcano ASR, Doubao E2E Realtime Q&A, Doubao LLM summaries/minutes, real mic capture, credential tests, WS reconnect, Windows prevent-sleep.

**Architecture:** Layer boundaries from M1 hold. New `src/audio/` module wraps `getUserMedia` + AudioWorklet. `src/logic/AudioRouter` routes mic chunks to ASR (listening) or E2E (wake-word Q&A). Rust WS bridges (`volcano_ws`, `e2e_ws`) own connection lifecycle and emit typed events. Doubao LLM stays pure-TS `fetch`. Reconnect state machine lives in `MeetingSession`.

**Tech Stack:** Tauri 2, React 18+, TypeScript, Vite, pnpm 10.29.3, Vitest, tokio-tungstenite (binary WS), uuid (connect IDs), dashmap (per-session handles), windows crate (Windows prevent-sleep), browser `getUserMedia` + `AudioWorkletNode` + `AudioContext`, Ark HTTP (Doubao LLM).

**Branch:** `feat/m2` off `main`. Node 22.14.0 via `nvm use 22.14.0`. All `git commit`, `pnpm test`, `cargo test` commands assume this shell setup.

---

## Scope confirmation

Spec: `docs/superpowers/specs/2026-04-19-supernono-m2-design.md`. Non-goals (do **not** add): cloud sync, meeting upload, meeting-notes API, Linux packaging, fixture-mode FakeClock fix, mid-meeting language switching.

## Volcano / Doubao protocol facts to memorize

Referenced repeatedly below. All integers big-endian on the wire.

### Volcano Streaming ASR (bigmodel_async)

- **URL:** `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
- **Required headers:**
  - `X-Api-App-Key: <volcano_app_id>`
  - `X-Api-Access-Key: <volcano_access_key>`
  - `X-Api-Resource-Id: volc.bigasr.sauc.duration`
  - `X-Api-Connect-Id: <random uuid v4>`
- **Binary frame shape:** `[4B header][optional 4B sequence][4B payload_size][payload]`
- **Header byte layout:**
  - byte 0: `(protocol_version << 4) | header_size_words` — fixed `0x11` (v1, 4-byte header)
  - byte 1: `(message_type << 4) | flags`
  - byte 2: `(serialization << 4) | compression`
  - byte 3: reserved `0x00`
- **Message types:**
  - `0b0001` — Full client request (first frame, JSON params)
  - `0b0010` — Audio-only client request (subsequent audio)
  - `0b1001` — Full server response (JSON result)
  - `0b1111` — Error message from server
- **Flags:**
  - `0b0001` — payload includes 4B sequence (positive)
  - `0b0010` — last packet, no sequence
  - `0b0011` — last packet, negative sequence
- **Serialization:** `0b0000` raw / `0b0001` JSON
- **Compression:** `0b0000` none / `0b0001` gzip — M2 uses **none** (simpler; server accepts)
- **First frame (full client request) payload (JSON, uncompressed):**
  ```json
  {
    "user": { "uid": "supernono" },
    "audio": { "format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1 },
    "request": { "model_name": "bigmodel", "enable_punc": true, "enable_itn": true, "show_utterances": true, "end_window_size": 800 }
  }
  ```
- **Server response JSON (subset we care about):**
  ```json
  {
    "result": {
      "text": "全量文本",
      "utterances": [
        { "text": "这是一句", "start_time": 0, "end_time": 1705, "definite": true }
      ]
    }
  }
  ```
  — emit `partial` if no utterance has `definite: true`, emit `final` for each `definite: true` utterance.

### Doubao E2E Realtime (dialogue)

- **URL:** `wss://openspeech.bytedance.com/api/v3/realtime/dialogue`
- **Required headers:**
  - `X-Api-App-ID: <volcano_app_id>` (same App ID as ASR)
  - `X-Api-Access-Key: <volcano_access_key>`
  - `X-Api-Resource-Id: volc.speech.dialog`
  - `X-Api-App-Key: PlgvMymc7f3tQnJ6` (fixed constant per docs)
  - `X-Api-Connect-Id: <uuid>`
- **Binary frame shape:** `[4B header][optional fields][4B payload_size][payload]`
- **Header:** same byte layout as ASR but different flags semantics.
- **Message types:**
  - `0b0001` — Full client request
  - `0b1001` — Full server response
  - `0b0010` — Audio-only request
  - `0b1011` — Audio-only response
  - `0b1111` — Error
- **Flags (right nibble of byte 1):** bit 2 (`0b0100`) set → payload is preceded by 4B **event ID**. We always set it for control frames.
- **Session framing:** client session frames carry 4B `session_id_size` + `session_id` bytes immediately before payload.
- **Events we use:**
  - `1` StartConnection (empty JSON body)
  - `100` StartSession (carries TTS + dialog config, see below)
  - `102` FinishSession
  - `200` TaskRequest (audio-only, Message Type `0b0010`)
  - `2` FinishConnection
- **Server events (we decode):**
  - `50` ConnectionStarted (after StartConnection ack)
  - `150` SessionStarted (after StartSession ack)
  - `451` ASRInfo (user speech transcript) — payload `{ "result": { "text": "..." } }` → emit `question_transcript`
  - `550` TTSSentenceStart / `551` TTSResponse (assistant text) — emit `answer_transcript` on `550`
  - `352` TTSEnded (turn finished) → emit `turn_end`
  - Audio-only responses (Message Type `0b1011`) → emit `audio` with raw PCM bytes
- **StartSession payload (JSON):**
  ```json
  {
    "tts": {
      "speaker": "zh_female_vv_jupiter_bigtts",
      "audio_config": { "channel": 1, "format": "pcm", "sample_rate": 24000 }
    },
    "dialog": {
      "bot_name": "Nono",
      "system_role": "<system prompt from QaHandoff>",
      "extra": { "input_mod": "audio" , "model": "1.2.1.1" }
    }
  }
  ```
  — model `1.2.1.1` = O2.0 version (supports vv speaker).
- **Audio chunk size:** 20 ms at 16 kHz s16le mono = 640 bytes; **docs strongly recommend 20 ms per chunk**. We batch our 200 ms worklet chunks into 10×20 ms sub-packets before `sendAudio`, or send the 200 ms chunk directly — either works. M2 sends the 200 ms chunk to keep the worklet→invoke path unchanged; Rust splits into 20 ms frames before writing to WS.

### Doubao LLM (Ark)

- **URL:** `https://ark.cn-beijing.volces.com/api/v3/chat/completions`
- **Headers:** `Authorization: Bearer <doubao_api_key>`, `Content-Type: application/json`
- **Default model:** `doubao-1-5-pro-256k` (hardcoded in M2, user-override deferred)
- **Request shape (non-streaming):**
  ```json
  { "model": "doubao-1-5-pro-256k", "messages": [{"role":"user","content":"<prompt>"}], "stream": false, "max_tokens": 1500 }
  ```
- **Response shape:**
  ```json
  { "choices": [ { "message": { "content": "..." } } ] }
  ```
- **Streaming:** set `"stream": true`, server sends `text/event-stream` with `data: {...}` lines terminated by `data: [DONE]`. Each data line has `choices[0].delta.content`.

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/audio/MicCapture.ts` | Wraps `getUserMedia` + AudioWorklet. Emits `chunk(Uint8Array)` and `rms(number)`. Injectable `AudioContextFactory` for tests. |
| `src/audio/MicCapture.test.ts` | Vitest tests with `FakeAudioContext`. |
| `src/audio/worklet/downsample-worklet.js` | Raw `AudioWorkletProcessor`. 48kHz Float32 → 16kHz Int16 LE, posts 200ms chunks + per-50ms RMS. |
| `src/logic/AudioRouter.ts` | Pure class. `feed(chunk)` forwards to active sink. `switchTo('asr'\|'e2e')`. |
| `src/logic/AudioRouter.test.ts` | Vitest. |
| `src/logic/__fakes__/FakeMicCapture.ts` | Test double implementing `MicCaptureHandle`. Scripted chunks + rms. |
| `src/adapters/DoubaoLlmClient.test.ts` | Tests real `fetch`-based client via `vi.stubGlobal`. |
| `src-tauri/tests/ws_bridge.rs` | Feature-gated integration test (`--features ws-integration`) against local mock WS server. |
| `docs/manual-smoke-m2.md` | 8-step manual smoke checklist. |
| `public/worklet/downsample-worklet.js` | Static-served copy of the worklet (Vite doesn't process this path; worklet must be a classic JS file). |

### Modified files

| Path | Change |
|---|---|
| `src/logic/adapters.ts` | `AsrClient.sendAudio(chunk)` added. `AsrError`/`E2eError` typed payload. `MicCaptureHandle` interface. |
| `src/logic/__fakes__/FakeAsrClient.ts` | Implement `sendAudio`, `emitError({retryable})`. |
| `src/logic/__fakes__/FakeE2eClient.ts` | Same. |
| `src/logic/MeetingSession.ts` | Own `MicCapture` + `AudioRouter`. Reconnect state machine. Emit `orbState: { amplitude }`. |
| `src/logic/MeetingSession.test.ts` | Extended for reconnect + audio routing + amplitude. |
| `src/logic/QaHandoff.ts` | Use `AudioRouter.switchTo`. |
| `src/logic/QaHandoff.test.ts` | Updated for router coupling. |
| `src/adapters/VolcanoAsrClient.ts` | `sendAudio` method; typed error payload from Rust. |
| `src/adapters/DoubaoE2eClient.ts` | Typed error payload. |
| `src/adapters/DoubaoLlmClient.ts` | Real `fetch` implementation. |
| `src-tauri/src/commands/volcano_ws.rs` | Real `connect_async`, send/recv tasks, typed errors. |
| `src-tauri/src/commands/e2e_ws.rs` | Same. |
| `src-tauri/src/commands/prevent_sleep.rs` | Windows impl. |
| `src-tauri/src/lib.rs` | Register new shared state (session maps). |
| `src-tauri/Cargo.toml` | Deps: `tokio-tungstenite`, `uuid`, `dashmap`, `windows` (Windows only), `futures-util`. |
| `src-tauri/tauri.conf.json` | CSP: allow `wss://openspeech.bytedance.com` + `https://ark.cn-beijing.volces.com`. |
| `src/hooks/useMeetingSession.ts` | Expose `amplitude` + `status`. |
| `src/ui/Orb.tsx` | Accept optional `amplitude` prop. |
| `src/ui/Sidebar.tsx` | Recording pill color by status. |
| `src/ui/IdleView.tsx` | Mic-permission help card when `lastError === 'mic_denied'`. |
| `src/App.tsx` | Instantiate real adapters + `MicCapture`; thread status/amplitude. |
| `vite.config.ts` | Ensure `public/worklet/*` is copied to `dist/` (default Vite behavior — verify). |

---

## Phase 1 — Foundation: typed errors, adapter interface, fakes

### Task 1: Add typed error envelope + MicCaptureHandle to adapters.ts

**Files:**
- Modify: `src/logic/adapters.ts`
- Modify: `src/logic/types.ts` (add `AsrErrorKind`)

- [ ] **Step 1: Write failing test for typed error narrowing**

Append to `src/logic/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AsrError, AsrErrorKind } from './types';

describe('AsrError', () => {
  it('narrows by kind', () => {
    const e: AsrError = { kind: 'auth', message: 'bad key', retryable: false };
    const kinds: AsrErrorKind[] = ['auth', 'network', 'rate_limit', 'server', 'protocol'];
    expect(kinds).toContain(e.kind);
    expect(e.retryable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
nvm use 22.14.0 && pnpm vitest run src/logic/types.test.ts
```

Expected: FAIL — `AsrError` not exported.

- [ ] **Step 3: Add types to `src/logic/types.ts`**

Append at end:

```ts
export type AsrErrorKind = 'auth' | 'network' | 'rate_limit' | 'server' | 'protocol';

export interface AsrError {
  kind: AsrErrorKind;
  message: string;
  retryable: boolean;
}

export type E2eErrorKind = AsrErrorKind;
export type E2eError = AsrError;
```

- [ ] **Step 4: Update `src/logic/adapters.ts` — AsrClient gains sendAudio, errors are typed**

Replace the file body with:

```ts
import type {
  Utterance, Summary, MeetingMeta, AiExchange, FullMeeting, TestResult,
  AsrError, E2eError,
} from './types';

export type Unsubscribe = () => void;

export interface AsrOpts {
  lang: 'zh' | 'en';
  enableSpeakerId: boolean;
}

export interface AsrClient {
  start(opts: AsrOpts): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  stop(): Promise<void>;
  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
}

export interface E2eOpen {
  systemPrompt: string;
  voice: string;
}

export interface E2eClient {
  open(opts: E2eOpen): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  on(event: 'question_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'answer_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'audio', cb: (p: Uint8Array) => void): Unsubscribe;
  on(event: 'turn_end', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: E2eError) => void): Unsubscribe;
  close(): Promise<void>;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
}

export interface LlmReq { prompt: string }
export interface LlmResp { text: string }
export interface LlmChunk { delta: string }

export interface LlmClient {
  complete(req: LlmReq): Promise<LlmResp>;
  stream(req: LlmReq): AsyncIterable<LlmChunk>;
  testCredentials(apiKey: string): Promise<TestResult>;
}

export interface Persistence {
  createMeeting(meta: MeetingMeta): Promise<void>;
  appendUtterance(mtgId: string, u: Utterance): Promise<void>;
  writeSummaries(mtgId: string, summaries: Summary[]): Promise<void>;
  writeMeta(mtgId: string, meta: MeetingMeta): Promise<void>;
  writeMinutes(mtgId: string, md: string): Promise<void>;
  writeAiExchanges(mtgId: string, exchanges: AiExchange[]): Promise<void>;
  listMeetings(): Promise<MeetingMeta[]>;
  readMeeting(mtgId: string): Promise<FullMeeting>;
  exportMinutes(mtgId: string, destPath: string): Promise<void>;
}

export interface MicCaptureHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'chunk', cb: (chunk: Uint8Array) => void): Unsubscribe;
  on(event: 'rms', cb: (rms: number) => void): Unsubscribe;
  on(event: 'error', cb: (err: Error) => void): Unsubscribe;
}
```

- [ ] **Step 5: Run types test to verify pass**

```bash
pnpm vitest run src/logic/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/logic/adapters.ts src/logic/types.ts src/logic/types.test.ts
git commit -m "feat(logic): typed ASR/E2E errors + MicCaptureHandle interface"
```

### Task 2: Update FakeAsrClient for new contract

**Files:**
- Modify: `src/logic/__fakes__/FakeAsrClient.ts`
- Modify: `src/logic/__fakes__/FakeAsrClient.test.ts`

- [ ] **Step 1: Write failing test for sendAudio + emitError(retryable)**

Replace `src/logic/__fakes__/FakeAsrClient.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { FakeAsrClient } from './FakeAsrClient';
import type { AsrError } from '../types';

describe('FakeAsrClient', () => {
  it('records sendAudio chunks for inspection', () => {
    const c = new FakeAsrClient();
    const a = new Uint8Array([1, 2, 3]);
    c.sendAudio(a);
    c.sendAudio(new Uint8Array([4]));
    expect(c.sentChunks.length).toBe(2);
    expect(c.sentChunks[0]).toEqual(a);
  });

  it('emits typed error with retryable flag', async () => {
    const c = new FakeAsrClient();
    await c.start({ lang: 'zh', enableSpeakerId: false });
    const spy = vi.fn();
    c.on('error', spy);
    const err: AsrError = { kind: 'network', message: 'drop', retryable: true };
    c.emitError(err);
    expect(spy).toHaveBeenCalledWith(err);
  });

  it('emits scripted finals', async () => {
    const c = new FakeAsrClient();
    await c.start({ lang: 'zh', enableSpeakerId: false });
    const seen: string[] = [];
    c.on('final', (u) => seen.push(u.text));
    c.scriptFinal({ text: 'hi', startMs: 0, endMs: 100, isFinal: true });
    expect(seen).toEqual(['hi']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/logic/__fakes__/FakeAsrClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `src/logic/__fakes__/FakeAsrClient.ts`**

```ts
import type { AsrClient, AsrOpts, Unsubscribe } from '../adapters';
import type { Utterance, AsrError, TestResult } from '../types';

export class FakeAsrClient implements AsrClient {
  public sentChunks: Uint8Array[] = [];
  private started = false;
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  async start(_opts: AsrOpts): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }

  sendAudio(chunk: Uint8Array): void {
    if (!this.started) return;
    this.sentChunks.push(chunk);
  }

  on(event: 'partial' | 'final' | 'error' | 'closed', cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb as (p: unknown) => void);
    return () => { set.delete(cb as (p: unknown) => void); };
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return { ok: true };
  }

  scriptPartial(u: Utterance): void { this.emit('partial', u); }
  scriptFinal(u: Utterance): void { this.emit('final', u); }
  emitError(e: AsrError): void { this.emit('error', e); }
  emitClosed(): void { this.emit('closed', undefined); }

  private emit(event: string, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/logic/__fakes__/FakeAsrClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeAsrClient.ts src/logic/__fakes__/FakeAsrClient.test.ts
git commit -m "feat(fakes): FakeAsrClient gains sendAudio + typed emitError"
```

### Task 3: Update FakeE2eClient for typed error

**Files:**
- Modify: `src/logic/__fakes__/FakeE2eClient.ts`
- Modify: `src/logic/__fakes__/FakeE2eClient.test.ts`

- [ ] **Step 1: Add failing test for typed error**

Append to `src/logic/__fakes__/FakeE2eClient.test.ts`:

```ts
import type { E2eError } from '../types';

it('emits typed error', async () => {
  const c = new FakeE2eClient();
  await c.open({ systemPrompt: 'p', voice: 'v' });
  const seen: E2eError[] = [];
  c.on('error', (e) => seen.push(e as E2eError));
  const err: E2eError = { kind: 'server', message: 'boom', retryable: true };
  c.emitError(err);
  expect(seen).toEqual([err]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/logic/__fakes__/FakeE2eClient.test.ts
```

Expected: FAIL — `emitError` not defined.

- [ ] **Step 3: Add `emitError` to `FakeE2eClient`**

Append to `src/logic/__fakes__/FakeE2eClient.ts` inside the class:

```ts
emitError(e: import('../types').E2eError): void {
  this.emit('error', e);
}
```

Also update `testCredentials` signature to match new adapter — change parameter list to `(appId: string, accessKey: string)`:

```ts
async testCredentials(_appId: string, _accessKey: string): Promise<import('../types').TestResult> {
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/logic/__fakes__/FakeE2eClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeE2eClient.ts src/logic/__fakes__/FakeE2eClient.test.ts
git commit -m "feat(fakes): FakeE2eClient gains typed emitError"
```

### Task 4: Update existing call sites that break under new types

**Files:**
- Modify: `src/logic/QaHandoff.ts` (adjust typed-error handler)
- Modify: `src/logic/__integration__/scripted-meeting.test.ts` (no change expected, verify)

- [ ] **Step 1: Run the full test suite to see what broke**

```bash
pnpm vitest run
```

Expected: Some failures in `MeetingSession.test.ts` / `QaHandoff.test.ts` if they pass `Error` instances to `error` listeners. Capture the list.

- [ ] **Step 2: For each failing test, update call sites**

Search for `.on('error', ...)` invocations in non-test logic files and ensure they accept `AsrError` / `E2eError` (not `Error`). Typical fix in `QaHandoff.ts`:

```ts
// before:
// asr.on('error', (e: Error) => ...)
// after:
asr.on('error', (_e) => { /* ... */ });
```

Where tests previously emitted raw `Error`, switch them to the typed shape:

```ts
fakeAsr.emitError({ kind: 'network', message: 'x', retryable: true });
```

- [ ] **Step 3: Run full suite again**

```bash
pnpm vitest run && cd src-tauri && cargo test && cd ..
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: align call sites with typed AsrError/E2eError"
```

---

## Phase 2 — AudioRouter + FakeMicCapture

### Task 5: Write AudioRouter test

**Files:**
- Create: `src/logic/AudioRouter.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { AudioRouter } from './AudioRouter';

describe('AudioRouter', () => {
  it('routes to active sink only', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    const r = new AudioRouter({ asr, e2e });
    r.feed(new Uint8Array([1]));
    expect(asr).toHaveBeenCalledTimes(1);
    expect(e2e).not.toHaveBeenCalled();
  });

  it('switchTo changes sink atomically', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    const r = new AudioRouter({ asr, e2e });
    r.feed(new Uint8Array([1]));      // → asr
    r.switchTo('e2e');
    r.feed(new Uint8Array([2]));      // → e2e
    r.feed(new Uint8Array([3]));      // → e2e
    r.switchTo('asr');
    r.feed(new Uint8Array([4]));      // → asr
    expect(asr).toHaveBeenCalledTimes(2);
    expect(e2e).toHaveBeenCalledTimes(2);
  });

  it('defaults to asr', () => {
    const asr = vi.fn();
    const e2e = vi.fn();
    new AudioRouter({ asr, e2e }).feed(new Uint8Array([9]));
    expect(asr).toHaveBeenCalled();
  });

  it('exposes current active sink', () => {
    const r = new AudioRouter({ asr: vi.fn(), e2e: vi.fn() });
    expect(r.active).toBe('asr');
    r.switchTo('e2e');
    expect(r.active).toBe('e2e');
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm vitest run src/logic/AudioRouter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/logic/AudioRouter.ts`**

```ts
export type Sink = 'asr' | 'e2e';

export interface AudioRouterSinks {
  asr: (chunk: Uint8Array) => void;
  e2e: (chunk: Uint8Array) => void;
}

export class AudioRouter {
  private current: Sink = 'asr';
  constructor(private sinks: AudioRouterSinks) {}

  get active(): Sink { return this.current; }

  switchTo(next: Sink): void { this.current = next; }

  feed(chunk: Uint8Array): void {
    this.sinks[this.current](chunk);
  }
}
```

- [ ] **Step 4: Run to verify passes**

```bash
pnpm vitest run src/logic/AudioRouter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/AudioRouter.ts src/logic/AudioRouter.test.ts
git commit -m "feat(logic): AudioRouter routes mic chunks to ASR or E2E"
```

### Task 6: Write FakeMicCapture test + implementation

**Files:**
- Create: `src/logic/__fakes__/FakeMicCapture.ts`
- Create: `src/logic/__fakes__/FakeMicCapture.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { FakeMicCapture } from './FakeMicCapture';

describe('FakeMicCapture', () => {
  it('buffers chunks until started', async () => {
    const m = new FakeMicCapture();
    const spy = vi.fn();
    m.on('chunk', spy);
    m.scriptChunk(new Uint8Array([1]));
    expect(spy).not.toHaveBeenCalled();
    await m.start();
    m.scriptChunk(new Uint8Array([2]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits rms', async () => {
    const m = new FakeMicCapture();
    await m.start();
    const rms: number[] = [];
    m.on('rms', (r) => rms.push(r));
    m.scriptRms(0.1);
    m.scriptRms(0.5);
    expect(rms).toEqual([0.1, 0.5]);
  });

  it('stop suppresses further emissions', async () => {
    const m = new FakeMicCapture();
    await m.start();
    const spy = vi.fn();
    m.on('chunk', spy);
    await m.stop();
    m.scriptChunk(new Uint8Array([1]));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/logic/__fakes__/FakeMicCapture.ts`**

```ts
import type { MicCaptureHandle, Unsubscribe } from '../adapters';

type Ev = 'chunk' | 'rms' | 'error';

export class FakeMicCapture implements MicCaptureHandle {
  private running = false;
  private listeners = new Map<Ev, Set<(p: never) => void>>();

  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }

  on(event: 'chunk', cb: (c: Uint8Array) => void): Unsubscribe;
  on(event: 'rms', cb: (r: number) => void): Unsubscribe;
  on(event: 'error', cb: (e: Error) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => { set.delete(cb); };
  }

  scriptChunk(c: Uint8Array): void { if (this.running) this.emit('chunk', c); }
  scriptRms(r: number): void { if (this.running) this.emit('rms', r); }
  scriptError(e: Error): void { if (this.running) this.emit('error', e); }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
```

- [ ] **Step 4: Run to verify passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeMicCapture.ts src/logic/__fakes__/FakeMicCapture.test.ts
git commit -m "feat(fakes): FakeMicCapture for MeetingSession tests"
```

---

## Phase 3 — MicCapture + downsample worklet

### Task 7: Create downsample worklet file

**Files:**
- Create: `src/audio/worklet/downsample-worklet.js`
- Create: `public/worklet/downsample-worklet.js` (identical copy, served as static asset)

- [ ] **Step 1: Write the worklet**

`src/audio/worklet/downsample-worklet.js` (and verbatim copy at `public/worklet/downsample-worklet.js`):

```js
// Downsamples 48kHz Float32 → 16kHz Int16 LE.
// Posts 200ms chunks (3200 samples @16kHz = 6400 bytes) on 'chunk'.
// Posts RMS (0..1) every ~50ms on 'rms'.
// Assumes input sample rate is 48000 Hz (standard browser default).

class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Decimation factor 3 (48000 → 16000). Simple pick-every-third-sample.
    // For 16kHz ASR this is acceptable — the anti-alias filter in the
    // browser's audio path already attenuates above ~20kHz and Volcano
    // tolerates minor aliasing from a 24kHz Nyquist source.
    this.decim = 3;
    this.sampleIdx = 0;
    this.chunkBuf = new Int16Array(3200); // 200ms @ 16kHz
    this.chunkWriteIdx = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
    this.rmsWindowSamples = 800; // 50ms @ 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      if (this.sampleIdx % this.decim === 0) {
        const f = Math.max(-1, Math.min(1, ch[i]));
        const s16 = f < 0 ? Math.round(f * 0x8000) : Math.round(f * 0x7fff);
        this.chunkBuf[this.chunkWriteIdx++] = s16;
        this.rmsSum += f * f;
        this.rmsCount++;

        if (this.rmsCount >= this.rmsWindowSamples) {
          const rms = Math.sqrt(this.rmsSum / this.rmsCount);
          this.port.postMessage({ type: 'rms', value: rms });
          this.rmsSum = 0;
          this.rmsCount = 0;
        }

        if (this.chunkWriteIdx >= this.chunkBuf.length) {
          // Copy to a fresh ArrayBuffer so we can transfer ownership.
          const out = new Int16Array(this.chunkBuf.length);
          out.set(this.chunkBuf);
          this.port.postMessage(
            { type: 'chunk', buffer: out.buffer },
            [out.buffer],
          );
          this.chunkWriteIdx = 0;
        }
      }
      this.sampleIdx++;
    }
    return true;
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
```

- [ ] **Step 2: Verify Vite copies it**

```bash
pnpm vite build --mode development 2>&1 | grep worklet
ls dist/worklet/
```

Expected: `dist/worklet/downsample-worklet.js` present.

- [ ] **Step 3: Commit**

```bash
git add src/audio/worklet/downsample-worklet.js public/worklet/downsample-worklet.js
git commit -m "feat(audio): downsample AudioWorklet (48k Float32 → 16k Int16)"
```

### Task 8: Write MicCapture test with FakeAudioContext

**Files:**
- Create: `src/audio/MicCapture.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicCapture } from './MicCapture';

// A minimal fake of the AudioContext surface we use.
class FakeWorkletPort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  fire(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
class FakeWorkletNode {
  port = new FakeWorkletPort();
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeMediaStreamSource { connect = vi.fn(); disconnect = vi.fn(); }
class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createMediaStreamSource = vi.fn(() => new FakeMediaStreamSource());
  close = vi.fn();
  workletNode = new FakeWorkletNode();
}

describe('MicCapture', () => {
  let ctx: FakeAudioContext;
  let getStream: ReturnType<typeof vi.fn>;
  let buildNode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    getStream = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    buildNode = vi.fn().mockReturnValue(ctx.workletNode);
  });

  it('starts, adds worklet, wires node', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode,
    });
    await m.start();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('/worklet/downsample-worklet.js');
    expect(buildNode).toHaveBeenCalled();
  });

  it('emits chunk from worklet port message', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode,
    });
    await m.start();
    const chunks: Uint8Array[] = [];
    m.on('chunk', (c) => chunks.push(c));
    const buf = new Int16Array([1, -1, 2]).buffer;
    ctx.workletNode.port.fire({ type: 'chunk', buffer: buf });
    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(6);
  });

  it('emits rms', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode,
    });
    await m.start();
    const seen: number[] = [];
    m.on('rms', (r) => seen.push(r));
    ctx.workletNode.port.fire({ type: 'rms', value: 0.42 });
    expect(seen).toEqual([0.42]);
  });

  it('stop closes audio resources', async () => {
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: getStream,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode,
    });
    await m.start();
    await m.stop();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('emits error event when getUserMedia rejects', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const m = new MicCapture({
      contextFactory: () => ctx as unknown as AudioContext,
      getUserMedia: failing,
      workletUrl: '/worklet/downsample-worklet.js',
      buildNode,
    });
    await expect(m.start()).rejects.toThrow('NotAllowedError');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/audio/MicCapture.ts`**

```ts
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
    if (this.node) { this.node.disconnect(); this.node = null; }
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
    return () => { set.delete(cb); };
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
```

- [ ] **Step 4: Run to verify passes**

```bash
pnpm vitest run src/audio/MicCapture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/MicCapture.ts src/audio/MicCapture.test.ts
git commit -m "feat(audio): MicCapture wraps getUserMedia + AudioWorklet"
```

---

## Phase 4 — DoubaoLlmClient real fetch

### Task 9: Write DoubaoLlmClient happy-path test

**Files:**
- Create: `src/adapters/DoubaoLlmClient.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoubaoLlmClient } from './DoubaoLlmClient';

describe('DoubaoLlmClient.complete', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('POSTs to Ark with Bearer auth + default model', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi there' } }] }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('bad');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'auth', retryable: false,
    });
  });

  it('surfaces 429 as rate_limit retryable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      text: async () => 'throttled',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'rate_limit', retryable: true,
    });
  });

  it('surfaces 5xx as server retryable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'down',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'server', retryable: true,
    });
  });

  it('surfaces network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    const c = new DoubaoLlmClient('k');
    await expect(c.complete({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'network', retryable: true,
    });
  });

  it('throws if API key null (not configured)', async () => {
    const c = new DoubaoLlmClient(null);
    await expect(c.complete({ prompt: 'x' })).rejects.toThrow('Doubao API key not configured');
  });
});

describe('DoubaoLlmClient.testCredentials', () => {
  afterEach(() => { /* cleanup */ });
  it('returns ok on 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-valid');
    expect(r.ok).toBe(true);
  });
  it('returns !ok with reason on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'bad',
    }) as unknown as typeof fetch;
    const c = new DoubaoLlmClient(null);
    const r = await c.testCredentials('sk-bad');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/401|auth|key/i);
  });
  it('returns !ok with reason on network fail', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fail')) as unknown as typeof fetch;
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
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
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm vitest run src/adapters/DoubaoLlmClient.test.ts
```

Expected: FAIL — current stub throws "implemented in M2".

- [ ] **Step 3: Implement `src/adapters/DoubaoLlmClient.ts`**

Replace the existing file content with:

```ts
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
          'Authorization': `Bearer ${this.apiKey}`,
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
      const err: AsrError = { kind, message: `HTTP ${resp.status}: ${body.slice(0, 200)}`, retryable: retryableKind(kind) };
      throw err;
    }
    const data = await resp.json() as { choices: { message: { content: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? '' };
  }

  async *stream(req: LlmReq): AsyncIterable<LlmChunk> {
    if (!this.apiKey) throw new Error('Doubao API key not configured');
    const resp = await fetch(ARK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
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
      const err: AsrError = { kind, message: `HTTP ${resp.status}`, retryable: retryableKind(kind) };
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
          } catch { /* ignore malformed SSE line */ }
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
          'Authorization': `Bearer ${apiKey}`,
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
```

- [ ] **Step 4: Run to verify passes**

```bash
pnpm vitest run src/adapters/DoubaoLlmClient.test.ts
```

Expected: PASS (all seven cases).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/DoubaoLlmClient.ts src/adapters/DoubaoLlmClient.test.ts
git commit -m "feat(adapters): real Doubao LLM fetch against Ark"
```

---

## Phase 5 — Volcano ASR real WebSocket bridge

### Task 10: Add Rust deps for WS + UUID + DashMap

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Append to `[dependencies]`**

```toml
tokio-tungstenite = { version = "0.24", features = ["rustls-tls-webpki-roots"] }
futures-util = "0.3"
uuid = { version = "1", features = ["v4"] }
dashmap = "6"
bytes = "1"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_System_Power"] }
```

And add a feature flag:

```toml
[features]
default = []
ws-integration = []
```

- [ ] **Step 2: Build to verify lockfile resolves**

```bash
cd src-tauri && cargo fetch && cd ..
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(cargo): add tokio-tungstenite + dashmap + uuid + windows"
```

### Task 11: Extend SAUC frame codec (encode + decode)

**Files:**
- Modify: `src-tauri/src/commands/volcano_ws.rs` (expand `frame` module)

- [ ] **Step 1: Write failing test**

Replace the `#[cfg(test)] mod tests` inside the `frame` module with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_full_client_request() {
        let payload = br#"{"x":1}"#.to_vec();
        let bytes = encode_full_client_request(&payload);
        // header byte 0: 0x11 (v1, 4-byte header)
        assert_eq!(bytes[0], 0x11);
        // byte 1: message type 0b0001 << 4 | flags 0b0000 = 0x10
        assert_eq!(bytes[1], 0x10);
        // byte 2: serialization 0b0001 << 4 | compression 0b0000 = 0x10
        assert_eq!(bytes[2], 0x10);
        // byte 3: reserved = 0x00
        assert_eq!(bytes[3], 0x00);
        // bytes 4..8: payload size BE
        let size = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(size as usize, payload.len());
        // remainder: payload
        assert_eq!(&bytes[8..], &payload[..]);
    }

    #[test]
    fn encode_audio_only_request() {
        let pcm = vec![0x01u8, 0x02, 0x03];
        let bytes = encode_audio_only(&pcm);
        // header byte 0: 0x11
        assert_eq!(bytes[0], 0x11);
        // byte 1: msg type 0b0010 << 4 | flags 0b0000 = 0x20
        assert_eq!(bytes[1], 0x20);
        // byte 2: raw serialization, no compression = 0x00
        assert_eq!(bytes[2], 0x00);
        let size = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(size as usize, pcm.len());
        assert_eq!(&bytes[8..], &pcm[..]);
    }

    #[test]
    fn decode_full_server_response_partial() {
        // Build a minimal server response: header + sequence + payload_size + json
        let json = br#"{"result":{"text":"hello","utterances":[{"text":"hel","start_time":0,"end_time":100,"definite":false}]}}"#;
        let mut frame = vec![0x11u8, 0x91, 0x10, 0x00]; // msg type 0b1001, flags 0b0001 (sequence)
        frame.extend_from_slice(&1u32.to_be_bytes());   // sequence
        frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
        frame.extend_from_slice(json);

        let decoded = decode_server_frame(&frame).expect("decode");
        match decoded {
            ServerFrame::Response { utterances, .. } => {
                assert_eq!(utterances.len(), 1);
                assert_eq!(utterances[0].text, "hel");
                assert!(!utterances[0].definite);
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn decode_full_server_response_final() {
        let json = br#"{"result":{"text":"hello","utterances":[{"text":"hello","start_time":0,"end_time":300,"definite":true}]}}"#;
        let mut frame = vec![0x11u8, 0x91, 0x10, 0x00];
        frame.extend_from_slice(&2u32.to_be_bytes());
        frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
        frame.extend_from_slice(json);
        match decode_server_frame(&frame).unwrap() {
            ServerFrame::Response { utterances, .. } => {
                assert!(utterances[0].definite);
            }
            _ => panic!("expected Response"),
        }
    }

    #[test]
    fn decode_error_frame() {
        let err_text = b"bad request";
        let mut frame = vec![0x11u8, 0xf0, 0x00, 0x00]; // msg type 0b1111
        frame.extend_from_slice(&42u32.to_be_bytes());                   // error code
        frame.extend_from_slice(&(err_text.len() as u32).to_be_bytes()); // error msg size
        frame.extend_from_slice(err_text);
        match decode_server_frame(&frame).unwrap() {
            ServerFrame::Error { code, message } => {
                assert_eq!(code, 42);
                assert_eq!(message, "bad request");
            }
            _ => panic!("expected Error"),
        }
    }
}
```

- [ ] **Step 2: Run to verify fails**

```bash
cd src-tauri && cargo test volcano_ws::frame && cd ..
```

Expected: FAIL — helpers not defined.

- [ ] **Step 3: Implement the frame module**

Replace the `pub mod frame { … }` block with:

```rust
pub mod frame {
    use serde::Deserialize;

    #[derive(Debug, Clone, Deserialize)]
    pub struct Utterance {
        pub text: String,
        #[serde(default)]
        pub start_time: u64,
        #[serde(default)]
        pub end_time: u64,
        #[serde(default)]
        pub definite: bool,
    }

    #[derive(Debug)]
    pub enum ServerFrame {
        Response {
            sequence: i32,
            text: String,
            utterances: Vec<Utterance>,
        },
        Error {
            code: u32,
            message: String,
        },
    }

    pub fn encode_full_client_request(payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + payload.len());
        out.push(0x11); // v1, 4-byte header
        out.push(0x10); // msg_type=0b0001 (full client request), flags=0
        out.push(0x10); // serialization=JSON, compression=none
        out.push(0x00); // reserved
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    pub fn encode_audio_only(pcm: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + pcm.len());
        out.push(0x11);
        out.push(0x20); // msg_type=0b0010 (audio only), flags=0
        out.push(0x00); // serialization=raw, compression=none
        out.push(0x00);
        out.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
        out.extend_from_slice(pcm);
        out
    }

    pub fn encode_audio_only_last(pcm: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + pcm.len());
        out.push(0x11);
        out.push(0x22); // flags 0b0010 = last packet (negative)
        out.push(0x00);
        out.push(0x00);
        out.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
        out.extend_from_slice(pcm);
        out
    }

    pub fn decode_server_frame(bytes: &[u8]) -> Option<ServerFrame> {
        if bytes.len() < 4 { return None; }
        let msg_type = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let mut off = 4;
        let sequence = if (flags & 0b0001) != 0 && msg_type == 0b1001 {
            if bytes.len() < off + 4 { return None; }
            let s = i32::from_be_bytes(bytes[off..off+4].try_into().ok()?);
            off += 4;
            s
        } else { 0 };
        match msg_type {
            0b1001 => {
                if bytes.len() < off + 4 { return None; }
                let size = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size { return None; }
                let json = &bytes[off..off+size];
                #[derive(Deserialize)]
                struct Wrap { result: Option<Result_> }
                #[derive(Deserialize)]
                struct Result_ {
                    #[serde(default)] text: String,
                    #[serde(default)] utterances: Vec<Utterance>,
                }
                let parsed: Wrap = serde_json::from_slice(json).ok()?;
                let r = parsed.result.unwrap_or(Result_ { text: String::new(), utterances: vec![] });
                Some(ServerFrame::Response { sequence, text: r.text, utterances: r.utterances })
            }
            0b1111 => {
                if bytes.len() < off + 8 { return None; }
                let code = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?);
                let size = u32::from_be_bytes(bytes[off+4..off+8].try_into().ok()?) as usize;
                off += 8;
                if bytes.len() < off + size { return None; }
                let msg = String::from_utf8_lossy(&bytes[off..off+size]).into_owned();
                Some(ServerFrame::Error { code, message: msg })
            }
            _ => None,
        }
    }
    // (tests live below — see Step 1)
}
```

- [ ] **Step 4: Run test to verify passes**

```bash
cd src-tauri && cargo test volcano_ws::frame && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/volcano_ws.rs
git commit -m "feat(rust): SAUC frame encode/decode for ASR WS"
```

### Task 12: Implement asr_start real connect + session state

**Files:**
- Modify: `src-tauri/src/commands/volcano_ws.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add session registry state**

Add near the top of `volcano_ws.rs` (below `use`):

```rust
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

pub struct AsrSession {
    pub audio_tx: mpsc::Sender<Vec<u8>>,
    pub _send_join: JoinHandle<()>,
    pub _recv_join: JoinHandle<()>,
}

pub type AsrSessions = Arc<DashMap<String, AsrSession>>;

pub fn new_sessions() -> AsrSessions { Arc::new(DashMap::new()) }
```

Modify `src-tauri/src/lib.rs` to create and manage the registry. Add:

```rust
use commands::volcano_ws::{new_sessions as new_asr_sessions, AsrSessions};
```

Inside the `.setup(|app| { ... })` closure (or where state is registered), add:

```rust
app.manage::<AsrSessions>(new_asr_sessions());
```

- [ ] **Step 2: Write the real `asr_start`, `asr_send_audio`, `asr_stop`**

Replace the stub `asr_start`, `asr_send_audio`, `asr_stop`, `asr_test_credentials` in `volcano_ws.rs` with:

```rust
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{Emitter, Manager, State};
use tokio_tungstenite::{connect_async, tungstenite::{client::IntoClientRequest, protocol::Message}};
use uuid::Uuid;
use crate::commands::volcano_ws::frame::{encode_audio_only, encode_full_client_request, decode_server_frame, ServerFrame};

const ASR_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

#[derive(Debug, serde::Serialize, Clone)]
pub struct TypedError {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

impl TypedError {
    pub fn auth(msg: impl Into<String>) -> Self { Self { kind: "auth".into(), message: msg.into(), retryable: false } }
    pub fn network(msg: impl Into<String>) -> Self { Self { kind: "network".into(), message: msg.into(), retryable: true } }
    pub fn server(msg: impl Into<String>) -> Self { Self { kind: "server".into(), message: msg.into(), retryable: true } }
    pub fn protocol(msg: impl Into<String>) -> Self { Self { kind: "protocol".into(), message: msg.into(), retryable: false } }
    pub fn rate_limit(msg: impl Into<String>) -> Self { Self { kind: "rate_limit".into(), message: msg.into(), retryable: true } }
}

#[tauri::command]
pub async fn asr_start(
    app: tauri::AppHandle,
    sessions: State<'_, AsrSessions>,
    session_id: String,
    app_id: String,
    access_key: String,
    params: AsrStartParams,
) -> Result<(), String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = ASR_URL.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-Key", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    h.insert("X-Api-Resource-Id", "volc.bigasr.sauc.duration".parse().unwrap());
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let (ws, _resp) = match connect_async(req).await {
        Ok(ok) => ok,
        Err(e) => {
            let msg = e.to_string();
            let kind = if msg.contains("401") || msg.contains("403") {
                TypedError::auth(msg)
            } else {
                TypedError::network(msg)
            };
            app.emit("asr://error", kind).ok();
            return Err("connect failed".into());
        }
    };

    let (mut sink, mut stream) = ws.split();

    // First frame: full client request with audio+request config.
    let first_payload = json!({
        "user": { "uid": "supernono" },
        "audio": { "format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1 },
        "request": {
            "model_name": "bigmodel",
            "enable_punc": true,
            "enable_itn": true,
            "show_utterances": true,
            "end_window_size": 800
        }
    });
    let first_bytes = encode_full_client_request(first_payload.to_string().as_bytes());
    if let Err(e) = sink.send(Message::Binary(first_bytes.into())).await {
        app.emit("asr://error", TypedError::network(e.to_string())).ok();
        return Err("send first frame failed".into());
    }

    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);

    let app_send = app.clone();
    let send_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(pcm) = rx.recv().await {
            let frame = encode_audio_only(&pcm);
            if let Err(e) = sink.send(Message::Binary(frame.into())).await {
                app_send.emit("asr://error", TypedError::network(e.to_string())).ok();
                break;
            }
        }
        let _ = sink.close().await;
    });

    let app_recv = app.clone();
    let recv_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Binary(bytes)) => {
                    if let Some(frame) = decode_server_frame(&bytes) {
                        match frame {
                            ServerFrame::Response { utterances, .. } => {
                                for u in utterances {
                                    let payload = serde_json::json!({
                                        "text": u.text,
                                        "startMs": u.start_time,
                                        "endMs": u.end_time,
                                        "isFinal": u.definite,
                                    });
                                    let ev = if u.definite { "asr://final" } else { "asr://partial" };
                                    app_recv.emit(ev, payload).ok();
                                }
                            }
                            ServerFrame::Error { code, message } => {
                                let kind = if code == 401 || code == 403 {
                                    TypedError::auth(message)
                                } else if code == 429 {
                                    TypedError::rate_limit(message)
                                } else if code >= 500 {
                                    TypedError::server(message)
                                } else {
                                    TypedError::protocol(message)
                                };
                                app_recv.emit("asr://error", kind).ok();
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => { app_recv.emit("asr://closed", ()).ok(); break; }
                Err(e) => {
                    app_recv.emit("asr://error", TypedError::network(e.to_string())).ok();
                    break;
                }
                _ => {}
            }
        }
    });

    sessions.insert(session_id, AsrSession { audio_tx: tx, _send_join: send_join, _recv_join: recv_join });
    let _ = params; // silence unused
    Ok(())
}

#[tauri::command]
pub async fn asr_send_audio(
    sessions: State<'_, AsrSessions>,
    session_id: String,
    pcm_chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(sess) = sessions.get(&session_id) {
        // Drop on full channel — slightly better than backpressure for a live capture loop.
        let _ = sess.audio_tx.try_send(pcm_chunk);
        Ok(())
    } else {
        Err("session not found".into())
    }
}

#[tauri::command]
pub async fn asr_stop(
    sessions: State<'_, AsrSessions>,
    session_id: String,
) -> Result<(), String> {
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn asr_test_credentials(
    app_id: String,
    access_key: String,
) -> Result<TestResult, String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = match ASR_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => return Ok(TestResult { ok: false, reason: Some(e.to_string()) }),
    };
    let h = req.headers_mut();
    let _ = h.insert("X-Api-App-Key", app_id.parse().unwrap());
    let _ = h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    let _ = h.insert("X-Api-Resource-Id", "volc.bigasr.sauc.duration".parse().unwrap());
    let _ = h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());
    match tokio::time::timeout(std::time::Duration::from_secs(5), connect_async(req)).await {
        Ok(Ok((ws, _))) => {
            let (mut sink, _stream) = ws.split();
            let _ = sink.close().await;
            Ok(TestResult { ok: true, reason: None })
        }
        Ok(Err(e)) => Ok(TestResult { ok: false, reason: Some(e.to_string()) }),
        Err(_) => Ok(TestResult { ok: false, reason: Some("timeout".into()) }),
    }
}
```

- [ ] **Step 3: Remove `#[allow(dead_code)]` annotations** in the `frame` module — they're used now.

- [ ] **Step 4: Build and run all Rust tests**

```bash
cd src-tauri && cargo build && cargo test && cd ..
```

Expected: build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/volcano_ws.rs src-tauri/src/lib.rs
git commit -m "feat(rust): real Volcano ASR WS bridge + typed error events"
```

### Task 13: Feature-gated WS integration test for ASR bridge

**Files:**
- Create: `src-tauri/tests/ws_bridge.rs`

- [ ] **Step 1: Write failing integration test**

```rust
#![cfg(feature = "ws-integration")]

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

// Spins up a mock WS server on an ephemeral port, returns its addr.
async fn mock_server_echo_partial() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let ws = accept_async(stream).await.unwrap();
            let (mut sink, mut rx) = ws.split();
            // On first binary frame from client, reply with a stubbed server response frame
            if let Some(Ok(Message::Binary(_))) = rx.next().await {
                let json = br#"{"result":{"text":"hi","utterances":[{"text":"hi","start_time":0,"end_time":100,"definite":true}]}}"#;
                let mut frame: Vec<u8> = vec![0x11, 0x91, 0x10, 0x00];
                frame.extend_from_slice(&1u32.to_be_bytes());
                frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
                frame.extend_from_slice(json);
                let _ = sink.send(Message::Binary(frame.into())).await;
            }
        }
    });
    addr
}

#[tokio::test]
async fn mock_server_round_trip() {
    let addr = mock_server_echo_partial().await;
    // Direct WS round-trip: open, send dummy first frame, expect server response frame
    use tokio_tungstenite::connect_async;
    let url = format!("ws://{}/", addr);
    let (ws, _) = connect_async(url).await.expect("connect");
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Binary(vec![0u8; 8].into())).await.unwrap();
    let msg = stream.next().await.unwrap().unwrap();
    assert!(matches!(msg, Message::Binary(_)));
}
```

- [ ] **Step 2: Run with feature flag to verify it passes**

```bash
cd src-tauri && cargo test --features ws-integration --test ws_bridge && cd ..
```

Expected: PASS.

- [ ] **Step 3: Verify default `cargo test` skips it**

```bash
cd src-tauri && cargo test && cd ..
```

Expected: the integration test is compiled-out; no ws-integration output.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/ws_bridge.rs
git commit -m "test(rust): feature-gated WS integration harness"
```

---

## Phase 6 — Doubao E2E Realtime WebSocket bridge

### Task 14: Extend E2E frame codec

**Files:**
- Modify: `src-tauri/src/commands/e2e_ws.rs`

- [ ] **Step 1: Write failing test**

Replace the `#[cfg(test)]` block inside `e2e_ws::frame` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_start_connection_frame() {
        let bytes = encode_start_connection();
        // byte 0 = 0x11; byte 1 = msg_type=0b0001 << 4 | flags=0b0100 (event) = 0x14
        assert_eq!(bytes[0], 0x11);
        assert_eq!(bytes[1], 0x14);
        // byte 2 = serialization JSON | compression none = 0x10
        assert_eq!(bytes[2], 0x10);
        assert_eq!(bytes[3], 0x00);
        // next 4 bytes: event id = 1
        assert_eq!(&bytes[4..8], &1u32.to_be_bytes());
        // then payload size (4B) and empty JSON {}
        let size = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
        assert_eq!(size, 2);
        assert_eq!(&bytes[12..14], b"{}");
    }

    #[test]
    fn encode_start_session_carries_session_id_and_payload() {
        let bytes = encode_start_session("sess-1", "prompt", "vv");
        assert_eq!(bytes[0], 0x11);
        assert_eq!(bytes[1], 0x14);          // event flag
        // event id = 100
        assert_eq!(&bytes[4..8], &100u32.to_be_bytes());
        // session id size
        let sid_size = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(sid_size, "sess-1".len());
        // session id bytes
        assert_eq!(&bytes[12..12 + sid_size], b"sess-1");
        // payload size
        let payload_off = 12 + sid_size;
        let payload_size = u32::from_be_bytes(bytes[payload_off..payload_off+4].try_into().unwrap()) as usize;
        let payload = &bytes[payload_off+4..payload_off+4+payload_size];
        let parsed: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(parsed["tts"]["speaker"], "vv");
        assert_eq!(parsed["tts"]["audio_config"]["format"], "pcm");
        assert_eq!(parsed["tts"]["audio_config"]["sample_rate"], 24000);
        assert_eq!(parsed["dialog"]["system_role"], "prompt");
    }

    #[test]
    fn encode_task_request_carries_audio() {
        let pcm = vec![0xAAu8, 0xBB, 0xCC];
        let bytes = encode_task_request("sess-1", &pcm);
        // msg type 0b0010 (audio only) | flags 0b0100 (event) = 0x24
        assert_eq!(bytes[1], 0x24);
        // serialization raw | compression none = 0x00
        assert_eq!(bytes[2], 0x00);
        assert_eq!(&bytes[4..8], &200u32.to_be_bytes()); // event id 200
    }

    #[test]
    fn decode_session_started_server_event() {
        // header + event id (150) + payload size + payload
        let payload = br#"{}"#;
        let mut frame = vec![0x11u8, 0x94, 0x10, 0x00];
        frame.extend_from_slice(&150u32.to_be_bytes());
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(payload);
        match decode_server_frame(&frame).unwrap() {
            ServerFrame::Event { event_id, .. } => assert_eq!(event_id, 150),
            _ => panic!("expected event"),
        }
    }

    #[test]
    fn decode_audio_only_response() {
        let pcm = vec![0x00, 0x01, 0x02, 0x03];
        let mut frame = vec![0x11u8, 0xb0, 0x00, 0x00]; // msg 0b1011 audio-only response
        frame.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
        frame.extend_from_slice(&pcm);
        match decode_server_frame(&frame).unwrap() {
            ServerFrame::Audio { pcm: got } => assert_eq!(got, pcm),
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn decode_error_frame() {
        let err_payload = br#"{"error":"boom"}"#;
        let mut frame = vec![0x11u8, 0xf0, 0x10, 0x00];
        frame.extend_from_slice(&9u32.to_be_bytes()); // error code
        frame.extend_from_slice(&(err_payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(err_payload);
        match decode_server_frame(&frame).unwrap() {
            ServerFrame::Error { code, message } => {
                assert_eq!(code, 9);
                assert!(message.contains("boom"));
            }
            _ => panic!("expected error"),
        }
    }
}
```

- [ ] **Step 2: Implement the E2E frame module**

Replace the `pub mod frame { ... }` with:

```rust
pub mod frame {
    use serde_json::json;

    #[derive(Debug)]
    pub enum ServerFrame {
        Event { event_id: u32, payload: Vec<u8> },
        Audio { pcm: Vec<u8> },
        Error { code: u32, message: String },
    }

    fn header(msg_type: u8, has_event: bool, ser: u8, comp: u8) -> [u8; 4] {
        let flags = if has_event { 0b0100 } else { 0b0000 };
        [0x11, (msg_type << 4) | flags, (ser << 4) | comp, 0x00]
    }

    fn write_event_frame(
        msg_type: u8, ser: u8, event_id: u32,
        session_id: Option<&str>, payload: &[u8],
    ) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&header(msg_type, true, ser, 0));
        out.extend_from_slice(&event_id.to_be_bytes());
        if let Some(sid) = session_id {
            out.extend_from_slice(&(sid.len() as u32).to_be_bytes());
            out.extend_from_slice(sid.as_bytes());
        }
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    pub fn encode_start_connection() -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 1, None, b"{}")
    }

    pub fn encode_start_session(session_id: &str, system_prompt: &str, voice: &str) -> Vec<u8> {
        let payload = json!({
            "tts": {
                "speaker": voice,
                "audio_config": { "channel": 1, "format": "pcm", "sample_rate": 24000 }
            },
            "dialog": {
                "bot_name": "Nono",
                "system_role": system_prompt,
                "extra": { "input_mod": "audio", "model": "1.2.1.1" }
            }
        });
        let body = payload.to_string();
        write_event_frame(0b0001, 0b0001, 100, Some(session_id), body.as_bytes())
    }

    pub fn encode_finish_session(session_id: &str) -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 102, Some(session_id), b"{}")
    }

    pub fn encode_finish_connection() -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 2, None, b"{}")
    }

    pub fn encode_task_request(session_id: &str, pcm: &[u8]) -> Vec<u8> {
        write_event_frame(0b0010, 0b0000, 200, Some(session_id), pcm)
    }

    pub fn decode_server_frame(bytes: &[u8]) -> Option<ServerFrame> {
        if bytes.len() < 4 { return None; }
        let msg_type = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let mut off = 4;
        match msg_type {
            0b1001 => {
                // Full server response; flag 0b0100 means event present.
                let event_id = if flags & 0b0100 != 0 {
                    if bytes.len() < off + 4 { return None; }
                    let e = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?);
                    off += 4; e
                } else { 0 };
                if bytes.len() < off + 4 { return None; }
                let size = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size { return None; }
                let payload = bytes[off..off+size].to_vec();
                Some(ServerFrame::Event { event_id, payload })
            }
            0b1011 => {
                if bytes.len() < off + 4 { return None; }
                let size = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size { return None; }
                let pcm = bytes[off..off+size].to_vec();
                Some(ServerFrame::Audio { pcm })
            }
            0b1111 => {
                if bytes.len() < off + 4 { return None; }
                let code = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?);
                off += 4;
                if bytes.len() < off + 4 { return None; }
                let size = u32::from_be_bytes(bytes[off..off+4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size { return None; }
                let msg = String::from_utf8_lossy(&bytes[off..off+size]).into_owned();
                Some(ServerFrame::Error { code, message: msg })
            }
            _ => None,
        }
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cd src-tauri && cargo test e2e_ws::frame && cd ..
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/e2e_ws.rs
git commit -m "feat(rust): E2E frame codec (events, session id, audio, error)"
```

### Task 15: Implement e2e_open / e2e_send_audio / e2e_close

**Files:**
- Modify: `src-tauri/src/commands/e2e_ws.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add session registry**

Append to `e2e_ws.rs`:

```rust
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use futures_util::{SinkExt, StreamExt};
use tauri::{Emitter, State};
use tokio_tungstenite::{connect_async, tungstenite::{client::IntoClientRequest, protocol::Message}};
use uuid::Uuid;
use crate::commands::volcano_ws::TypedError;
use crate::commands::e2e_ws::frame::{
    encode_start_connection, encode_start_session, encode_finish_session,
    encode_task_request, decode_server_frame, ServerFrame,
};

const E2E_URL: &str = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
const E2E_APP_KEY: &str = "PlgvMymc7f3tQnJ6"; // fixed per docs

pub struct E2eSession {
    pub audio_tx: mpsc::Sender<Vec<u8>>,
    pub _send_join: JoinHandle<()>,
    pub _recv_join: JoinHandle<()>,
}

pub type E2eSessions = Arc<DashMap<String, E2eSession>>;
pub fn new_e2e_sessions() -> E2eSessions { Arc::new(DashMap::new()) }
```

In `lib.rs`, add:

```rust
use commands::e2e_ws::{new_e2e_sessions, E2eSessions};
// ... in setup:
app.manage::<E2eSessions>(new_e2e_sessions());
```

- [ ] **Step 2: Replace stub commands with real ones**

```rust
#[tauri::command]
pub async fn e2e_open(
    app: tauri::AppHandle,
    sessions: State<'_, E2eSessions>,
    session_id: String,
    app_id: String,
    access_key: String,
    opts: E2eOpenOpts,
) -> Result<(), String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = E2E_URL.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-ID", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    h.insert("X-Api-Resource-Id", "volc.speech.dialog".parse().unwrap());
    h.insert("X-Api-App-Key", E2E_APP_KEY.parse().unwrap());
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let (ws, _) = match connect_async(req).await {
        Ok(ok) => ok,
        Err(e) => {
            let msg = e.to_string();
            let kind = if msg.contains("401") || msg.contains("403") {
                TypedError::auth(msg)
            } else { TypedError::network(msg) };
            app.emit("e2e://error", kind).ok();
            return Err("connect failed".into());
        }
    };
    let (mut sink, mut stream) = ws.split();

    // StartConnection → StartSession
    sink.send(Message::Binary(encode_start_connection().into())).await.map_err(|e| e.to_string())?;
    sink.send(Message::Binary(encode_start_session(&session_id, &opts.system_prompt, &opts.voice).into())).await.map_err(|e| e.to_string())?;

    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);
    let sid_send = session_id.clone();
    let app_send = app.clone();
    let send_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(pcm) = rx.recv().await {
            // Split into ~20ms sub-frames (640 bytes at 16kHz s16le mono).
            const SUB: usize = 640;
            for chunk in pcm.chunks(SUB) {
                let frame = encode_task_request(&sid_send, chunk);
                if let Err(e) = sink.send(Message::Binary(frame.into())).await {
                    app_send.emit("e2e://error", TypedError::network(e.to_string())).ok();
                    return;
                }
            }
        }
        // Graceful finish
        let _ = sink.send(Message::Binary(encode_finish_session(&sid_send).into())).await;
        let _ = sink.close().await;
    });

    let app_recv = app.clone();
    let recv_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Binary(bytes)) => {
                    match decode_server_frame(&bytes) {
                        Some(ServerFrame::Event { event_id, payload }) => {
                            match event_id {
                                451 => {
                                    // user transcript
                                    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                        let text = v["result"]["text"].as_str().unwrap_or("");
                                        app_recv.emit("e2e://question_transcript", serde_json::json!({ "text": text })).ok();
                                    }
                                }
                                550 | 551 => {
                                    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                        let text = v["text"].as_str().or(v["content"].as_str()).unwrap_or("");
                                        app_recv.emit("e2e://answer_transcript", serde_json::json!({ "text": text })).ok();
                                    }
                                }
                                352 => {
                                    app_recv.emit("e2e://turn_end", ()).ok();
                                }
                                _ => { /* connection/session lifecycle events — ignore */ }
                            }
                        }
                        Some(ServerFrame::Audio { pcm }) => {
                            app_recv.emit("e2e://audio", pcm).ok();
                        }
                        Some(ServerFrame::Error { code, message }) => {
                            let kind = if code == 401 || code == 403 {
                                TypedError::auth(message)
                            } else if code == 429 { TypedError::rate_limit(message) }
                            else if code >= 500 { TypedError::server(message) }
                            else { TypedError::protocol(message) };
                            app_recv.emit("e2e://error", kind).ok();
                        }
                        None => {}
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    app_recv.emit("e2e://error", TypedError::network(e.to_string())).ok();
                    break;
                }
                _ => {}
            }
        }
    });

    sessions.insert(session_id, E2eSession { audio_tx: tx, _send_join: send_join, _recv_join: recv_join });
    Ok(())
}

#[tauri::command]
pub async fn e2e_send_audio(
    sessions: State<'_, E2eSessions>,
    session_id: String,
    pcm_chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(sess) = sessions.get(&session_id) {
        let _ = sess.audio_tx.try_send(pcm_chunk);
        Ok(())
    } else { Err("session not found".into()) }
}

#[tauri::command]
pub async fn e2e_close(
    sessions: State<'_, E2eSessions>,
    session_id: String,
) -> Result<(), String> {
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn e2e_test_credentials(
    app_id: String,
    access_key: String,
) -> Result<TestResult, String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = match E2E_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => return Ok(TestResult { ok: false, reason: Some(e.to_string()) }),
    };
    let h = req.headers_mut();
    let _ = h.insert("X-Api-App-ID", app_id.parse().unwrap());
    let _ = h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    let _ = h.insert("X-Api-Resource-Id", "volc.speech.dialog".parse().unwrap());
    let _ = h.insert("X-Api-App-Key", E2E_APP_KEY.parse().unwrap());
    let _ = h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    match tokio::time::timeout(std::time::Duration::from_secs(5), connect_async(req)).await {
        Ok(Ok((ws, _))) => {
            let (mut sink, _stream) = ws.split();
            let _ = sink.send(Message::Binary(encode_start_connection().into())).await;
            let _ = sink.close().await;
            Ok(TestResult { ok: true, reason: None })
        }
        Ok(Err(e)) => Ok(TestResult { ok: false, reason: Some(e.to_string()) }),
        Err(_) => Ok(TestResult { ok: false, reason: Some("timeout".into()) }),
    }
}
```

- [ ] **Step 3: Update the `E2eOpenOpts` struct — rename field**

The existing struct had `system_prompt` and `voice`; the new command signature adds `app_id` + `access_key` arguments directly, which means the TS adapter call shape changes too (addressed in Task 17).

- [ ] **Step 4: Build**

```bash
cd src-tauri && cargo build && cargo test && cd ..
```

Expected: build + tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/e2e_ws.rs src-tauri/src/lib.rs
git commit -m "feat(rust): real E2E WS bridge — StartConnection/Session + audio routing"
```

### Task 16: Update invoke handler registration

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Ensure all new/changed commands are in `generate_handler!`**

Confirm the `tauri::generate_handler![...]` macro call includes:

```
commands::volcano_ws::asr_start,
commands::volcano_ws::asr_send_audio,
commands::volcano_ws::asr_stop,
commands::volcano_ws::asr_test_credentials,
commands::e2e_ws::e2e_open,
commands::e2e_ws::e2e_send_audio,
commands::e2e_ws::e2e_close,
commands::e2e_ws::e2e_test_credentials,
```

If any are missing, add them.

- [ ] **Step 2: Build**

```bash
cd src-tauri && cargo build && cd ..
```

Expected: no errors.

- [ ] **Step 3: Commit (if changes)**

```bash
git add src-tauri/src/lib.rs
git commit -m "chore(tauri): ensure ASR + E2E commands registered"
```

### Task 17: Update TS adapters to send appId/accessKey + typed error parsing

**Files:**
- Modify: `src/adapters/VolcanoAsrClient.ts`
- Modify: `src/adapters/DoubaoE2eClient.ts`

- [ ] **Step 1: Replace `VolcanoAsrClient` body**

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult, AsrError } from '../logic/types';

type Ev = 'partial' | 'final' | 'error' | 'closed';

export class VolcanoAsrClient implements AsrClient {
  private listeners = new Map<Ev, Set<(p: never) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(private sessionId: string, private appId: string, private accessKey: string) {}

  async start(opts: AsrOpts): Promise<void> {
    this.unlistens.push(
      await listen<Utterance>('asr://partial', (e) => this.emit('partial', e.payload)),
    );
    this.unlistens.push(
      await listen<Utterance>('asr://final', (e) => this.emit('final', e.payload)),
    );
    this.unlistens.push(
      await listen<AsrError>('asr://error', (e) => this.emit('error', e.payload)),
    );
    this.unlistens.push(
      await listen('asr://closed', () => this.emit('closed', undefined)),
    );
    await invoke('asr_start', {
      sessionId: this.sessionId,
      appId: this.appId,
      accessKey: this.accessKey,
      params: { lang: opts.lang, enableSpeakerId: opts.enableSpeakerId },
    });
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('asr_send_audio', { sessionId: this.sessionId, pcmChunk: Array.from(chunk) });
  }

  async stop(): Promise<void> {
    try { await invoke('asr_stop', { sessionId: this.sessionId }); } catch { /* ignore */ }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: 'partial', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'final', cb: (u: Utterance) => void): Unsubscribe;
  on(event: 'error', cb: (e: AsrError) => void): Unsubscribe;
  on(event: 'closed', cb: () => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => { set.delete(cb); };
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('asr_test_credentials', { appId, accessKey });
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
```

- [ ] **Step 2: Replace `DoubaoE2eClient` body**

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { E2eClient, E2eOpen, Unsubscribe } from '../logic/adapters';
import type { TestResult, E2eError } from '../logic/types';

type Ev = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class DoubaoE2eClient implements E2eClient {
  private listeners = new Map<Ev, Set<(p: never) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(private sessionId: string, private appId: string, private accessKey: string) {}

  async open(opts: E2eOpen): Promise<void> {
    this.unlistens.push(
      await listen<{ text: string }>('e2e://question_transcript', (e) => this.emit('question_transcript', e.payload)),
    );
    this.unlistens.push(
      await listen<{ text: string }>('e2e://answer_transcript', (e) => this.emit('answer_transcript', e.payload)),
    );
    this.unlistens.push(
      await listen<number[]>('e2e://audio', (e) => this.emit('audio', new Uint8Array(e.payload))),
    );
    this.unlistens.push(
      await listen('e2e://turn_end', () => this.emit('turn_end', undefined)),
    );
    this.unlistens.push(
      await listen<E2eError>('e2e://error', (e) => this.emit('error', e.payload)),
    );
    await invoke('e2e_open', {
      sessionId: this.sessionId,
      appId: this.appId,
      accessKey: this.accessKey,
      opts: { system_prompt: opts.systemPrompt, voice: opts.voice },
    });
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('e2e_send_audio', { sessionId: this.sessionId, pcmChunk: Array.from(chunk) });
  }

  async close(): Promise<void> {
    try { await invoke('e2e_close', { sessionId: this.sessionId }); } catch { /* ignore */ }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: 'question_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'answer_transcript', cb: (p: { text: string }) => void): Unsubscribe;
  on(event: 'audio', cb: (p: Uint8Array) => void): Unsubscribe;
  on(event: 'turn_end', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: E2eError) => void): Unsubscribe;
  on(event: Ev, cb: (p: never) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(cb);
    return () => { set.delete(cb); };
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('e2e_test_credentials', { appId, accessKey });
  }

  private emit(event: Ev, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/VolcanoAsrClient.ts src/adapters/DoubaoE2eClient.ts
git commit -m "feat(adapters): thread credentials into invoke + typed error payloads"
```

---

## Phase 7 — MeetingSession: audio routing + reconnect + amplitude

### Task 18: MeetingSession owns MicCapture + AudioRouter

**Files:**
- Modify: `src/logic/MeetingSession.ts`
- Modify: `src/logic/MeetingSession.test.ts`

- [ ] **Step 1: Write failing test for mic chunks reaching ASR**

Append to `src/logic/MeetingSession.test.ts`:

```ts
it('routes mic chunks to ASR by default', async () => {
  const { session, asr, mic } = makeSession();
  await session.start();
  mic.scriptChunk(new Uint8Array([1, 2, 3]));
  mic.scriptChunk(new Uint8Array([4]));
  expect(asr.sentChunks.length).toBe(2);
});

it('emits amplitude from mic rms', async () => {
  const { session, mic } = makeSession();
  const levels: number[] = [];
  session.on('orbState', (s: { amplitude?: number }) => {
    if (typeof s.amplitude === 'number') levels.push(s.amplitude);
  });
  await session.start();
  mic.scriptRms(0.3);
  mic.scriptRms(0.7);
  expect(levels).toEqual([0.3, 0.7]);
});
```

Also update the `makeSession` helper at the top of the test to inject a `FakeMicCapture`:

```ts
import { FakeMicCapture } from './__fakes__/FakeMicCapture';

function makeSession() {
  const asr = new FakeAsrClient();
  const e2e = new FakeE2eClient();
  const llm = new FakeLlmClient();
  const clock = new FakeClock();
  const persistence = new InMemoryPersistence();
  const mic = new FakeMicCapture();
  const session = new MeetingSession({
    asr, e2e, llm, clock, persistence, mic,
    wakeWord: '嘿 Nono',
  });
  return { session, asr, e2e, llm, clock, persistence, mic };
}
```

- [ ] **Step 2: Run to verify failing**

```bash
pnpm vitest run src/logic/MeetingSession.test.ts
```

Expected: FAIL — `mic` param not accepted, no audio routing.

- [ ] **Step 3: Modify `MeetingSession.ts` constructor + start**

Add constructor parameter `mic: MicCaptureHandle` and in `start()` wire it:

```ts
// inside MeetingSession (abbreviated; merge with existing body)
private router: AudioRouter;
private mic: MicCaptureHandle;

constructor(deps: {
  asr: AsrClient; e2e: E2eClient; llm: LlmClient;
  clock: Clock; persistence: Persistence;
  mic: MicCaptureHandle; wakeWord: string;
}) {
  // ...
  this.mic = deps.mic;
  this.router = new AudioRouter({
    asr: (c) => deps.asr.sendAudio(c),
    e2e: (c) => deps.e2e.sendAudio(c),
  });
}

async start() {
  // ... existing logic
  this.mic.on('chunk', (c) => this.router.feed(c));
  this.mic.on('rms', (r) => this.emit('orbState', { amplitude: r }));
  await this.mic.start();
  // ... existing ASR start
}

async stop() {
  // ... existing logic
  await this.mic.stop();
}
```

Expose `router` so `QaHandoff` can call `switchTo`:

```ts
getRouter(): AudioRouter { return this.router; }
```

- [ ] **Step 4: Run test**

```bash
pnpm vitest run src/logic/MeetingSession.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/MeetingSession.ts src/logic/MeetingSession.test.ts
git commit -m "feat(logic): MeetingSession owns mic + AudioRouter; emits amplitude"
```

### Task 19: QaHandoff uses AudioRouter.switchTo

**Files:**
- Modify: `src/logic/QaHandoff.ts`
- Modify: `src/logic/QaHandoff.test.ts`

- [ ] **Step 1: Update test**

Modify the test to pass a `router` in and assert `switchTo` call order:

```ts
it('switches router to e2e before opening, back to asr after turn_end', async () => {
  const asr = new FakeAsrClient();
  const e2e = new FakeE2eClient();
  const router = new AudioRouter({ asr: (c) => asr.sendAudio(c), e2e: (c) => e2e.sendAudio(c) });
  await asr.start({ lang: 'zh', enableSpeakerId: false });
  const spy = vi.spyOn(router, 'switchTo');
  const handoff = new QaHandoff({ asr, e2e, router, systemPrompt: 'p', voice: 'v' });
  const done = handoff.start();
  await Promise.resolve();
  e2e.scriptTurn({ question: 'q', answer: 'a', audioChunks: [new Uint8Array([1])] });
  await done;
  expect(spy.mock.calls.map(c => c[0])).toEqual(['e2e', 'asr']);
});
```

- [ ] **Step 2: Run to verify fails**

Expected: FAIL — router not accepted.

- [ ] **Step 3: Modify `QaHandoff.ts` constructor**

```ts
constructor(deps: {
  asr: AsrClient;
  e2e: E2eClient;
  router: AudioRouter;
  systemPrompt: string;
  voice: string;
}) { /* save deps */ }

async start(): Promise<AiExchange> {
  this.router.switchTo('e2e');
  await this.asr.stop();
  await this.e2e.open({ systemPrompt: this.systemPrompt, voice: this.voice });
  // ... wait for turn_end ...
  await this.e2e.close();
  this.router.switchTo('asr');
  await this.asr.start({ lang: 'zh', enableSpeakerId: false });
  return exchange;
}
```

- [ ] **Step 4: Update `MeetingSession.ts`** to pass `router` when constructing `QaHandoff`:

```ts
new QaHandoff({ asr, e2e, router: this.router, systemPrompt, voice });
```

- [ ] **Step 5: Run test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/logic/QaHandoff.ts src/logic/QaHandoff.test.ts src/logic/MeetingSession.ts
git commit -m "feat(logic): QaHandoff drives AudioRouter switch in/out"
```

### Task 20: Reconnect state machine in MeetingSession

**Files:**
- Modify: `src/logic/MeetingSession.ts`
- Modify: `src/logic/MeetingSession.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
it('retryable error triggers reconnecting status then open', async () => {
  const { session, asr, clock } = makeSession();
  const statuses: string[] = [];
  session.on('statusChange', (s: string) => statuses.push(s));
  await session.start();
  expect(statuses).toContain('listening');
  asr.emitError({ kind: 'network', message: 'drop', retryable: true });
  await Promise.resolve();
  expect(statuses).toContain('reconnecting');
  // advance backoff 1s
  clock.advance(1000);
  await Promise.resolve();
  expect(statuses).toContain('listening');
});

it('three retryable errors in a row → paused', async () => {
  const { session, asr, clock } = makeSession();
  const statuses: string[] = [];
  session.on('statusChange', (s: string) => statuses.push(s));
  await session.start();
  for (let attempt = 0; attempt < 3; attempt++) {
    asr.emitError({ kind: 'network', message: 'x', retryable: true });
    await Promise.resolve();
    clock.advance([1000, 3000, 9000][attempt] + 10);
    await Promise.resolve();
    // simulate each reconnect also failing: emit again next loop
  }
  // After the third failure with no success, we should be paused.
  expect(statuses[statuses.length - 1]).toBe('paused');
});

it('non-retryable error → paused immediately', async () => {
  const { session, asr } = makeSession();
  const statuses: string[] = [];
  session.on('statusChange', (s: string) => statuses.push(s));
  await session.start();
  asr.emitError({ kind: 'auth', message: 'bad key', retryable: false });
  await Promise.resolve();
  expect(statuses[statuses.length - 1]).toBe('paused');
});

it('resume from paused re-triggers connect', async () => {
  const { session, asr } = makeSession();
  const statuses: string[] = [];
  session.on('statusChange', (s: string) => statuses.push(s));
  await session.start();
  asr.emitError({ kind: 'auth', message: 'x', retryable: false });
  await Promise.resolve();
  await session.resume();
  expect(statuses[statuses.length - 1]).toBe('listening');
});
```

- [ ] **Step 2: Run to verify fails**

Expected: FAIL — reconnect machine not present.

- [ ] **Step 3: Implement reconnect machine**

Add to `MeetingSession.ts`:

```ts
private status: 'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended' = 'idle';
private reconnectAttempt = 0;
private readonly BACKOFF_MS = [1000, 3000, 9000];

private setStatus(next: typeof this.status) {
  if (this.status === next) return;
  this.status = next;
  this.emit('statusChange', next);
}

private onAsrError = (e: AsrError) => {
  if (!e.retryable) {
    this.setStatus('paused');
    this.emit('error', e);
    return;
  }
  this.tryReconnect();
};

private tryReconnect() {
  if (this.reconnectAttempt >= this.BACKOFF_MS.length) {
    this.setStatus('paused');
    this.reconnectAttempt = 0;
    return;
  }
  this.setStatus('reconnecting');
  const wait = this.BACKOFF_MS[this.reconnectAttempt];
  this.reconnectAttempt++;
  this.clock.setTimeout(async () => {
    try {
      await this.asr.stop();
      await this.asr.start({ lang: 'zh', enableSpeakerId: false });
      this.setStatus('listening');
      this.reconnectAttempt = 0;
    } catch {
      this.tryReconnect();
    }
  }, wait);
}

async resume(): Promise<void> {
  if (this.status !== 'paused') return;
  this.reconnectAttempt = 0;
  this.setStatus('reconnecting');
  try {
    await this.asr.start({ lang: 'zh', enableSpeakerId: false });
    this.setStatus('listening');
  } catch {
    this.setStatus('paused');
  }
}
```

Wire `this.asr.on('error', this.onAsrError)` during `start()`, and `setStatus('listening')` once ASR start completes.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/MeetingSession.ts src/logic/MeetingSession.test.ts
git commit -m "feat(logic): reconnect state machine with 1s/3s/9s backoff + resume"
```

---

## Phase 8 — Windows prevent_sleep

### Task 21: Implement Windows SetThreadExecutionState

**Files:**
- Modify: `src-tauri/src/commands/prevent_sleep.rs`

- [ ] **Step 1: Read the current file**

Inspect current contents; the macOS impl should remain untouched.

- [ ] **Step 2: Add Windows impl behind `cfg(windows)`**

Replace / extend:

```rust
#[cfg(target_os = "macos")]
mod platform {
    // ... existing macOS impl stays ...
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::System::Power::{
        SetThreadExecutionState,
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, ES_DISPLAY_REQUIRED,
        EXECUTION_STATE,
    };

    pub fn start() -> Result<(), String> {
        // SAFETY: Win32 API, no pointers; EXECUTION_STATE is a u32 bitfield.
        let prev = unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
        };
        if prev == EXECUTION_STATE(0) { Err("SetThreadExecutionState failed".into()) } else { Ok(()) }
    }

    pub fn stop() -> Result<(), String> {
        let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        if prev == EXECUTION_STATE(0) { Err("SetThreadExecutionState clear failed".into()) } else { Ok(()) }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn start() -> Result<(), String> { Ok(()) }
    pub fn stop() -> Result<(), String> { Ok(()) }
}

#[tauri::command]
pub async fn prevent_sleep_start() -> Result<(), String> { platform::start() }

#[tauri::command]
pub async fn prevent_sleep_stop() -> Result<(), String> { platform::stop() }
```

- [ ] **Step 3: Add Windows unit test**

```rust
#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_start_stop_round_trip() {
        super::platform::start().unwrap();
        super::platform::stop().unwrap();
    }
}
```

- [ ] **Step 4: Build on dev machine (macOS)**

```bash
cd src-tauri && cargo build && cd ..
```

Expected: compiles (Windows branch compiles conditionally; on macOS it's not built, but the `windows` target-dep only applies there per the `[target.'cfg(windows)'.dependencies]` table in Cargo.toml).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/prevent_sleep.rs
git commit -m "feat(rust): Windows prevent_sleep via SetThreadExecutionState"
```

---

## Phase 9 — UI wiring: Orb amplitude, Sidebar pill, IdleView help card

### Task 22: Orb amplitude prop

**Files:**
- Modify: `src/ui/Orb.tsx`
- Modify: `src/ui/Orb.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/ui/Orb.test.tsx`:

```tsx
it('applies amplitude scale when amplitude prop provided', () => {
  const { container } = render(<Orb state="listening" amplitude={0.5} />);
  const root = container.querySelector('.orb');
  expect(root?.getAttribute('style') ?? '').toMatch(/--amplitude:\s*0?\.5/);
});

it('falls back to timer animation when amplitude undefined', () => {
  const { container } = render(<Orb state="listening" />);
  const root = container.querySelector('.orb');
  expect(root?.getAttribute('style') ?? '').not.toMatch(/--amplitude/);
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm vitest run src/ui/Orb.test.tsx
```

- [ ] **Step 3: Accept optional `amplitude` in Orb props**

In `src/ui/Orb.tsx`:

```tsx
interface OrbProps {
  state: 'idle' | 'listening' | 'answering' | 'paused';
  amplitude?: number; // 0..1
}

export function Orb({ state, amplitude }: OrbProps) {
  const style: CSSProperties = typeof amplitude === 'number'
    ? ({ ['--amplitude' as string]: amplitude.toFixed(3) })
    : {};
  return (
    <div className={`orb orb-${state}`} style={style}>
      {/* existing inner elements */}
    </div>
  );
}
```

And add a CSS rule driving scale with the var:

```css
/* src/ui/styles/desktop.css */
.orb { --amplitude: 0; }
.orb.orb-listening { transform: scale(calc(1 + var(--amplitude) * 0.08)); }
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Orb.tsx src/ui/Orb.test.tsx src/ui/styles/desktop.css
git commit -m "feat(ui): Orb scales with mic amplitude when provided"
```

### Task 23: Sidebar recording-pill colors by status

**Files:**
- Modify: `src/ui/Sidebar.tsx`
- Modify: `src/ui/styles/desktop.css`

- [ ] **Step 1: Accept `status` prop in Sidebar**

Edit `Sidebar.tsx` — add to props:

```tsx
status: 'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended';
onResumeClick?: () => void;
```

Render pill based on status:

```tsx
{status === 'listening' && <span className="pill pill-green">● Recording</span>}
{status === 'reconnecting' && <span className="pill pill-yellow">↻ Reconnecting…</span>}
{status === 'paused' && (
  <button className="pill pill-red" onClick={onResumeClick}>⏸ Paused — retry</button>
)}
```

- [ ] **Step 2: Add CSS**

```css
.pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.pill-green { background: #16a34a; color: white; }
.pill-yellow { background: #eab308; color: white; }
.pill-red { background: #dc2626; color: white; border: none; cursor: pointer; }
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/Sidebar.tsx src/ui/styles/desktop.css
git commit -m "feat(ui): sidebar pill reflects reconnect + paused states"
```

### Task 24: IdleView mic-permission help card

**Files:**
- Modify: `src/ui/IdleView.tsx`

- [ ] **Step 1: Accept `lastError` prop**

```tsx
interface IdleProps {
  onStart: () => void;
  lastError?: 'mic_denied' | 'other' | null;
  onOpenMicSettings?: () => void;
}
```

When `lastError === 'mic_denied'`, render a help block above the Start button:

```tsx
{lastError === 'mic_denied' && (
  <div className="mic-help">
    <h4>Microphone access denied</h4>
    <p>SuperNono needs your microphone to hear the meeting. Grant access in system settings, then retry.</p>
    <button onClick={onOpenMicSettings}>Open system settings</button>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/IdleView.tsx
git commit -m "feat(ui): IdleView shows mic-permission help on denial"
```

### Task 25: `open_mic_settings` Tauri command

**Files:**
- Create: `src-tauri/src/commands/settings_link.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create command**

`src-tauri/src/commands/settings_link.rs`:

```rust
#[tauri::command]
pub async fn open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
        std::process::Command::new("open").arg(url).status().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "ms-settings:privacy-microphone"])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { Err("unsupported platform".into()) }
}
```

- [ ] **Step 2: Register in `mod.rs` and `lib.rs` `generate_handler!`**

In `src-tauri/src/commands/mod.rs` add `pub mod settings_link;`.
In `lib.rs` handler list append `commands::settings_link::open_mic_settings`.

- [ ] **Step 3: Build**

```bash
cd src-tauri && cargo build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/settings_link.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): open_mic_settings command (macOS + Windows)"
```

---

## Phase 10 — Playback: E2E answer-audio queue

### Task 26: TS helper to stream PCM 24kHz Float32 into AudioContext

**Files:**
- Create: `src/audio/AnswerAudioPlayer.ts`
- Create: `src/audio/AnswerAudioPlayer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { AnswerAudioPlayer } from './AnswerAudioPlayer';

describe('AnswerAudioPlayer', () => {
  it('queues chunks and schedules buffers back-to-back', () => {
    const source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn(), onended: null as any };
    const ctx = {
      currentTime: 0,
      destination: {} as AudioDestinationNode,
      createBuffer: vi.fn((ch: number, len: number, rate: number) => {
        return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer;
      }),
      createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
    } as unknown as AudioContext;

    const p = new AnswerAudioPlayer(ctx);
    // 4 samples of float32 = 16 bytes
    const pcm = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    p.enqueue(new Uint8Array(pcm.buffer));

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 4, 24000);
    expect(source.start).toHaveBeenCalledTimes(1);
  });

  it('stop() clears queue and prevents further scheduling', () => {
    const source = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any };
    const ctx = {
      currentTime: 0,
      destination: {} as AudioDestinationNode,
      createBuffer: vi.fn((_c: number, len: number) => ({ length: len, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer)),
      createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
    } as unknown as AudioContext;

    const p = new AnswerAudioPlayer(ctx);
    p.enqueue(new Uint8Array(new Float32Array([0.1]).buffer));
    p.stop();
    // Further enqueue after stop should noop.
    const calls = (ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length;
    p.enqueue(new Uint8Array(new Float32Array([0.2]).buffer));
    expect((ctx.createBufferSource as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});
```

- [ ] **Step 2: Run to verify fails**

- [ ] **Step 3: Implement `src/audio/AnswerAudioPlayer.ts`**

```ts
const SAMPLE_RATE = 24000;

export class AnswerAudioPlayer {
  private nextStart: number;
  private stopped = false;
  constructor(private ctx: AudioContext) {
    this.nextStart = ctx.currentTime;
  }

  enqueue(chunk: Uint8Array): void {
    if (this.stopped) return;
    // Expect 32-bit float LE (pcm, single channel, 24000 Hz).
    const float = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4);
    const buffer = this.ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.nextStart, this.ctx.currentTime);
    source.start(startAt);
    this.nextStart = startAt + float.length / SAMPLE_RATE;
  }

  stop(): void {
    this.stopped = true;
  }
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/AnswerAudioPlayer.ts src/audio/AnswerAudioPlayer.test.ts
git commit -m "feat(audio): AnswerAudioPlayer streams E2E PCM 24k Float32 into AudioContext"
```

### Task 27: Wire AnswerAudioPlayer into QaHandoff

**Files:**
- Modify: `src/logic/QaHandoff.ts` (accept optional audio-player hook)
- Modify: `src/App.tsx` (provide player)

- [ ] **Step 1: Extend QaHandoff deps**

```ts
constructor(deps: {
  asr: AsrClient; e2e: E2eClient; router: AudioRouter;
  systemPrompt: string; voice: string;
  onAudioChunk?: (c: Uint8Array) => void;
}) { /* ... */ }
```

Inside the `audio` listener, call `onAudioChunk` if provided:

```ts
this.e2e.on('audio', (c) => { this.deps.onAudioChunk?.(c as Uint8Array); });
```

- [ ] **Step 2: Wire from `MeetingSession`**

Add an optional `audioPlayer` constructor parameter:

```ts
audioPlayer?: { enqueue(c: Uint8Array): void; stop(): void };
```

When creating `QaHandoff`, forward `onAudioChunk: (c) => this.audioPlayer?.enqueue(c)`.

- [ ] **Step 3: Commit**

```bash
git add src/logic/QaHandoff.ts src/logic/MeetingSession.ts
git commit -m "feat(logic): QaHandoff forwards E2E audio chunks to optional player"
```

---

## Phase 11 — App-level wiring: real adapters, CSP, hooks

### Task 28: CSP: allow Volcano + Ark hosts

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update CSP**

Inside `"app"` → `"security"` (or `"tauri"` → `"security"` depending on Tauri 2 schema), set:

```json
"csp": "default-src 'self'; connect-src 'self' wss://openspeech.bytedance.com https://ark.cn-beijing.volces.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:;"
```

(Keep any existing `'unsafe-inline'` directives needed by Vite HMR in dev — test both `pnpm tauri dev` and `pnpm tauri build`.)

- [ ] **Step 2: Verify app still launches**

```bash
pnpm tauri dev
```

Close cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(tauri): CSP allow openspeech WSS + Ark HTTPS"
```

### Task 29: `useMeetingSession` exposes status + amplitude + resume

**Files:**
- Modify: `src/hooks/useMeetingSession.ts`

- [ ] **Step 1: Extend hook return type**

```ts
interface UseMeetingSessionState {
  // ... existing fields
  status: 'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended';
  amplitude: number | null;
  lastError: string | null;
  resume: () => Promise<void>;
}
```

Subscribe to `statusChange`, `orbState`, `error` events inside an effect; update local state accordingly.

- [ ] **Step 2: Typecheck + smoke**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMeetingSession.ts
git commit -m "feat(hooks): useMeetingSession exposes status + amplitude + resume"
```

### Task 30: `App.tsx` wires real adapters + MicCapture

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Build real adapter instances based on Settings-provided credentials**

Near the top of `App.tsx` (merge with existing state; kept minimal here):

```tsx
const [creds, setCreds] = useState<{ appId: string; accessKey: string; doubaoKey: string } | null>(null);

// ... after creds loaded from keychain via useSettings:

const asr = useMemo(
  () => creds ? new VolcanoAsrClient('mtg', creds.appId, creds.accessKey) : null,
  [creds?.appId, creds?.accessKey],
);
const e2e = useMemo(
  () => creds ? new DoubaoE2eClient('mtg', creds.appId, creds.accessKey) : null,
  [creds?.appId, creds?.accessKey],
);
const llm = useMemo(
  () => new DoubaoLlmClient(creds?.doubaoKey ?? null),
  [creds?.doubaoKey],
);

const mic = useMemo(() => new MicCapture({
  contextFactory: () => new AudioContext(),
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  workletUrl: '/worklet/downsample-worklet.js',
}), []);
```

Pass `asr`, `e2e`, `llm`, `mic` into `useMeetingSession`.

- [ ] **Step 2: Handle mic_denied error**

In the start handler:

```tsx
const onStartMeeting = async () => {
  try {
    await session.start();
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('NotAllowed') || msg.includes('denied')) {
      setLastError('mic_denied');
    } else {
      setLastError('other');
    }
  }
};
```

- [ ] **Step 3: Pass `status` to `Sidebar` + `amplitude` to `Orb`** via existing prop threads.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): real adapters + MicCapture wired into MeetingSession"
```

### Task 31: Credential test buttons wired to real adapters (smoke check)

**Files:**
- Verify: `src/ui/SettingsModal.tsx` (existing; only ensures it now calls real adapter impls)

- [ ] **Step 1: Inspect `SettingsModal`**

It already calls `adapter.testCredentials`. No code change expected — the behavior change comes from the real adapters shipped in earlier tasks. Verify by walking through:

- `VolcanoAsrClient.testCredentials` → invokes `asr_test_credentials` → Rust opens WS with provided creds.
- `DoubaoE2eClient.testCredentials` → invokes `e2e_test_credentials` → Rust opens WS.
- `DoubaoLlmClient.testCredentials` → pure-TS `fetch` to Ark.

- [ ] **Step 2: Manual sanity (skip if no creds at hand)**

If the plan executor has real credentials, launch `pnpm tauri dev`, open Settings, paste creds, click Test → green OK expected.

- [ ] **Step 3: No commit (verification only).**

---

## Phase 12 — Manual smoke doc + CI green + housekeeping

### Task 32: Write `docs/manual-smoke-m2.md`

**Files:**
- Create: `docs/manual-smoke-m2.md`

- [ ] **Step 1: Write checklist**

```markdown
# M2 Manual Smoke Checklist

Run all 8 before declaring M2 done. Mark each `[x]` as you go.

## Prerequisites
- macOS (primary). Windows tester optional for step 7.
- Volcano App ID + Access Key + Doubao API key at hand.
- Wi-Fi available for step 5.

## Steps

- [ ] **1. First-launch microphone permission.**
  Delete `~/Library/Containers/com.supernono.app/` to simulate a first launch.
  Run `pnpm tauri dev`. Click Start Meeting. macOS should prompt for mic
  permission — grant it. Expected: meeting starts, Orb pulses.

- [ ] **2. Credential test buttons.**
  Open Settings. Paste all three credentials. Click each Test button.
  Expected: each shows green OK within 2 s. Paste a bogus key and test
  again — expect red error with message.

- [ ] **3. Real 10-minute meeting, ≥1 summary card.**
  Start a meeting, speak continuously (or play a podcast at the mic) for
  ~10 minutes. Expected: at least one summary card appears in the main
  pane around the 5-minute mark.

- [ ] **4. Wake-word Q&A.**
  Mid-meeting, say "嘿 Nono, 现在几点?" (or any question).
  Expected: Orb transitions to listening state, speech is captured,
  TTS answer plays aloud through the default output device, AiBlock
  chat bubble appears with question + answer text.

- [ ] **5. Wi-Fi drop + recover.**
  Mid-meeting, turn Wi-Fi off. Wait 4 seconds. Turn Wi-Fi on.
  Expected: sidebar pill flashes yellow "Reconnecting…" within 1 s of
  drop. After restore, pill returns to green "Recording". No final
  transcripts are lost before or after the drop.

- [ ] **6. End meeting + minutes export.**
  Click End Meeting. Expected: minutes render within ~10 s (or fallback
  message if Ark is slow). Export modal opens. Click Download. Save .md
  and open in Preview/Notepad — headers + bullets render correctly.

- [ ] **7. macOS: display sleep during meeting.**
  Start a meeting. Let display sleep (or close lid on laptop). Wait 2
  minutes. Wake. Expected: meeting still running, ASR still producing
  finals, no session paused.

- [ ] **8. Windows (if available): same as 7.**
  Confirm `SetThreadExecutionState` keeps the system awake for the
  duration of the meeting.

## Known limitations (not bugs)

- Fixture replay (`FixtureAsrClient`) still doesn't produce summaries in
  the 10-second demo — the real `SummaryScheduler` uses a real 5-minute
  interval. Deferred to a follow-up.
- Linux not supported.
- Doubao model is hardcoded to `doubao-1-5-pro-256k`; no UI override.
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual-smoke-m2.md
git commit -m "docs: M2 manual smoke checklist"
```

### Task 33: Run full `pnpm check` and fix any fallout

**Files:**
- Possibly: any — depends on what breaks.

- [ ] **Step 1: Run**

```bash
pnpm check
```

Expected: lint ✓, typecheck ✓, vitest ✓ (all previous + new tests), cargo fmt ✓, clippy ✓, cargo test ✓.

- [ ] **Step 2: Fix any red**

Likely candidates:
- Unused imports after adapter changes.
- Clippy `unused_must_use` on the `let _ = ...insert(...)` lines — harmless, suppress with `#[allow(clippy::let_underscore_must_use)]` on the function if noisy.
- Prettier complaints on new files.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: pnpm check green end-to-end for M2"
```

### Task 34: Update README for M2 status

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update "Status" section**

Replace / append:

```markdown
## Status

**M2 shipped** — real Volcano ASR + Doubao E2E Realtime + Doubao LLM, mic
capture via AudioWorklet, credential test buttons, WS reconnect with
backoff, Windows prevent-sleep. See `docs/manual-smoke-m2.md` for the
verification checklist.

Requires: Volcano App ID + Access Key, Doubao API key (entered in
Settings → keychain). macOS or Windows. Node 22.14+ with pnpm 10.29+.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README reflects M2 shipped + runtime prerequisites"
```

### Task 35: Final audit — run everything, verify no regressions

- [ ] **Step 1: Full check**

```bash
nvm use 22.14.0 && pnpm check && cd src-tauri && cargo test --features ws-integration && cd ..
```

Expected: green.

- [ ] **Step 2: Smoke-run the app once**

```bash
pnpm tauri dev
```

Expected: app launches, Settings works, idle view looks right.

- [ ] **Step 3: Stop here — plan complete.**

If credentials are available on the dev machine, run through `docs/manual-smoke-m2.md` before merging. Otherwise, defer to the human and land the branch with smoke deferred.

---

## Notes for the implementer

- Do **not** break M1's layer boundaries. All new business logic goes in `src/logic/` or `src/audio/`. React stays prop-driven. Rust owns only transport + native APIs.
- Every `src/logic/` and `src/audio/` file must have red-first tests. `src/adapters/` and `src/hooks/` get tests where they carry logic (DoubaoLlmClient yes; Keychain no-op passes through).
- Favor **small commits** per step, not per task. The bite-sized commits let us bisect if M2 introduces a regression during real-usage.
- If you find a spec requirement not covered by any task, **add a task**; do not silently skip.
- If a Rust command signature changes, update both the TS invoke call site and any fakes in the same commit.
- Do not attempt to unit-test the real `connect_async` call path without the feature-gated integration test harness.



