# SuperNono M2 Design — Real Volcano + Doubao + Mic

**Status:** Approved 2026-04-19.
**Prior art:** Builds on [M1 design](./2026-04-19-supernono-design.md) and the shipped [M1 plan](../plans/2026-04-19-supernono-m1.md). M1 delivered the full fake-drivable UX; M2 turns the stubs into real integrations.

## Goal

At end of M2, a user installs SuperNono, enters Volcano App ID + Access Key + Doubao API key in Settings, grants microphone permission on first meeting, and gets:

- Live ASR with rolling summary cards every ~5 minutes (real Volcano Streaming ASR).
- Wake-word-triggered voice Q&A with TTS response (real Doubao E2E Realtime).
- A real Markdown minutes document on meeting end (real Doubao LLM via Ark).
- Reconnect-on-drop resilience for both WebSocket paths.
- macOS and Windows prevent-sleep coverage for the duration of a meeting.

## Non-goals (deferred)

- Cloud sync / meeting upload / server-side history.
- Meeting-notes API (post-meeting transcription-based minutes — Doubao LLM covers this path already).
- Linux packaging.
- FixtureAsrClient FakeClock fix (fixture-mode summary cards remain a known limitation).
- Multi-language ASR switching mid-meeting.

## Stack additions

- `tokio-tungstenite` — already present, M2 fills in the `connect_async` call sites.
- `cpal` — **not** used. Mic capture is webview-side (AudioWorklet).
- Browser APIs used: `navigator.mediaDevices.getUserMedia`, `AudioContext`, `AudioWorkletNode`, `MessagePort`, `fetch` (for Doubao Ark).
- Rust `Windows` crate for `SetThreadExecutionState` (Windows prevent-sleep). No change on macOS.

## Architecture

Layer boundaries from M1 hold. No new module families — M2 adds two files under a new `src/audio/` peer to `src/logic/` and `src/adapters/`, and fills in existing Rust command bodies.

### New files

| Path | Responsibility |
|---|---|
| `src/audio/MicCapture.ts` | Wraps `getUserMedia` + AudioWorklet. Pure class with injectable `AudioContextFactory` for testability. Emits `chunk(Uint8Array)` ~5 Hz and `rms(number)` ~20 Hz. |
| `src/audio/worklet/downsample-worklet.js` | Raw `AudioWorkletProcessor`. Receives 48 kHz Float32, downsamples to 16 kHz (linear interpolation + low-pass decimation is overkill — simple decimation + clipping guard is sufficient at this sample rate), converts to Int16 little-endian, posts 200 ms chunks + per-50 ms RMS. Served as a static asset from `public/worklet/`. |
| `src/logic/AudioRouter.ts` | Pure class: owns the "current active sink" (`asr` or `e2e`). `feed(chunk)` forwards to active sink. `switchTo('asr'\|'e2e')` changes sink. Drops in-flight chunks on switch (no buffering — switch is atomic to the caller). |
| `src-tauri/tests/ws_bridge.rs` | Integration test harness spinning up an in-process mock WS server to exercise `asr_start` / `e2e_open` end-to-end. Feature-gated (`--features ws-integration`) so default `cargo test` stays fast. |

### Modified files

| Path | Change |
|---|---|
| `src/logic/adapters.ts` | `AsrClient` gains `sendAudio(chunk: Uint8Array): void`. `AsrClient.on('error', …)` payload becomes typed `{ kind: 'auth' \| 'network' \| 'rate_limit' \| 'server' \| 'protocol'; message: string; retryable: boolean }`. `E2eClient` error gets the same shape. `MicCaptureHandle` interface added for DI into `MeetingSession`. |
| `src/logic/MeetingSession.ts` | Owns a `MicCapture` + `AudioRouter`. On start: start mic, route to ASR. On wake-word: tell `QaHandoff` to take over (which calls `AudioRouter.switchTo('e2e')`). Owns reconnect state machine: 3 attempts with backoff 1s / 3s / 9s per WS. On reconnect exhaustion: emit `paused` with reason. New `resume()` method re-triggers reconnect after a pause. Emits `orbState` with `{ amplitude }` driven by mic RMS. |
| `src/logic/QaHandoff.ts` | Now closes/opens ASR around E2E via `AudioRouter` instead of via direct adapter coupling. Functional change is localized; tests extend but contract stays. |
| `src/adapters/VolcanoAsrClient.ts` | Adds `sendAudio(chunk)` (invokes `asr_send_audio`). Error event payload normalized to the typed shape by reading structured error events from Rust (`asr://error` payload is now the full typed error, not a raw string). |
| `src/adapters/DoubaoE2eClient.ts` | Same normalization. No new methods — contract already had `sendAudio`. |
| `src/adapters/DoubaoLlmClient.ts` | Real `fetch` to `https://ark.cn-beijing.volces.com/api/v3/chat/completions`. `complete()` posts non-streaming request, parses response. `stream()` uses SSE streaming (`Accept: text/event-stream`), yields `LlmChunk` per `data:` line. `testCredentials()` makes a 1-token completion, maps HTTP 200 → `{ ok: true }`, 401 → `{ ok: false, reason: 'Invalid API key' }`, network failure → `{ ok: false, reason: <message> }`. |
| `src/adapters/KeychainAdapter.ts` | No change. Keys unchanged (`volcano_app_id`, `volcano_access_key`, `doubao_api_key`). |
| `src-tauri/src/commands/volcano_ws.rs` | Fills in `asr_start`: opens WSS to `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` with required headers (`X-Api-App-Key`, `X-Api-Access-Key`, `X-Api-Resource-Id: volc.bigasr.sauc.duration`, `X-Api-Connect-Id: <uuid>`), spawns send + recv tasks, stores per-session `mpsc::Sender<Vec<u8>>` + `JoinHandle` in a `DashMap`. `asr_send_audio` pushes into the sender. `asr_stop` drops the entry (sender close triggers WS close from the task). `asr_test_credentials` does the same handshake but closes immediately after the server's hello frame; returns typed `TestResult`. Error events emitted as structured JSON. |
| `src-tauri/src/commands/e2e_ws.rs` | Fills in `e2e_open`: WSS to the Doubao E2E endpoint, sends `StartSession` JSON first (already has `encode_start_session`), spawns send + recv tasks. Send task frames PCM input per E2E protocol. Recv task demultiplexes JSON events (question_transcript, answer_transcript, turn_end) and binary PCM frames (24 kHz int16 mono — request flag set on StartSession). `e2e_close` sends `FinishSession` and drops the entry. `e2e_test_credentials` opens, sends StartSession, waits for `SessionStarted` ack, closes. |
| `src-tauri/src/commands/prevent_sleep.rs` | Adds Windows impl: on `prevent_sleep_start` calls `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED \| ES_DISPLAY_REQUIRED)`, on `prevent_sleep_stop` calls with `ES_CONTINUOUS` alone to clear. macOS impl unchanged. |
| `src/hooks/useMeetingSession.ts` | Subscribes to `orbState` events, exposes `amplitude: number \| null` in the returned state. |
| `src/ui/Orb.tsx` | Accepts optional `amplitude` prop. When provided, scales the inner gradient and pulse rate. When absent (fixture demo), falls back to the existing timer animation. |
| `src/ui/Sidebar.tsx` | Recording pill shows `Recording` (green), `Reconnecting…` (yellow), or `Paused` (red, clickable to retry) based on `meetingState.status`. |
| `src/ui/SettingsModal.tsx` | Already has Test buttons wired to `adapter.testCredentials`. No UI change — M2 just swaps the stub return values for real handshake results. |

### WS lifecycle (ASR, representative)

```
MeetingSession.start()
  → new MicCapture + new AudioRouter('asr')
  → VolcanoAsrClient.start()
      invoke('asr_start', { sessionId, appId, accessKey, params })
        Rust: connect_async(url, headers) → (sink, stream)
              spawn send_task(rx, sink)
              spawn recv_task(stream, app_handle, session_id)
              sessions.insert(session_id, SessionHandle { tx, send_join, recv_join })
      listen 'asr://partial' 'asr://final' 'asr://error' 'asr://closed'
  → MicCapture.start()
  → MicCapture.on('chunk', c => AudioRouter.feed(c))
  → MicCapture.on('rms',  r => session.emit('orbState', { amplitude: r }))

AudioRouter.feed(c) when active = 'asr'
  → VolcanoAsrClient.sendAudio(c)
      invoke('asr_send_audio', { sessionId, pcmChunk: Array.from(c) })
        Rust: sessions.get(id)?.tx.try_send(chunk) (bounded cap 32, drop on full with warn)
```

### Reconnect state machine (per WS)

```
[idle] --start--> [connecting] --ok--> [open]
                                    --drop--> [reconnecting:attempt=1]
[reconnecting:n] --wait backoff(n)--> [connecting]
                                    --ok--> [open]
                                    --fail & n<3--> [reconnecting:n+1]
                                    --fail & n==3--> [failed]
[failed] --user Resume--> [connecting]   (resets attempt counter)
```

Backoff: `[1000, 3000, 9000] ms`. Mic stays running during all reconnect attempts; chunks are dropped at the router rather than buffered (a 9 s buffer is not worth the complexity — user will notice the yellow pill). `MeetingSession` exposes a `status: 'idle' \| 'listening' \| 'reconnecting' \| 'paused' \| 'ended'`.

### E2E audio out: PCM not Opus

E2E is configured at `StartSession` time to return PCM (24 kHz, 32-bit float, single channel). Browser plays via `AudioContext.createBuffer()` + `AudioBufferSourceNode`, no decoder library. Trade-off: ~6× bandwidth vs. Opus, but bandwidth is trivial on a desktop and we avoid shipping an Opus decoder.

### Doubao LLM: pure-TS fetch

Doubao LLM runs in the webview via `fetch` directly to `ark.cn-beijing.volces.com`. Key lives in macOS keychain (read at session start), Tauri CSP allows outbound HTTPS to that host, no Rust hop. Chosen model default: `doubao-1-5-pro-256k` (large context for long meeting transcripts + summaries). User can override via Settings in a follow-up; M2 hard-codes the default.

## Data flow — three live paths

### Path 1: Continuous listening + summaries

```
Mic 48k Float32
  → AudioWorklet (downsample + Int16 + RMS)
  → MessagePort → MicCapture
  → AudioRouter(active=asr) → VolcanoAsrClient.sendAudio
  → invoke asr_send_audio → Rust mpsc → tungstenite write

Rust recv task:
  tungstenite read → parse SAUC JSON
  → emit 'asr://partial'|'final'|'error'|'closed'

TS:
  MeetingSession.onFinal → TranscriptBuffer.appendFinal → WakeWordMatcher
  SummaryScheduler tick (RealClock 5 min) → DoubaoLlmClient.complete(prompt) → emit 'summary'
  Orb pulses to amplitude
```

### Path 2: Wake-word Q&A

```
WakeWordMatcher.match(final.text) = true
  → QaHandoff.start()
      AudioRouter.switchTo('e2e')
      VolcanoAsrClient.stop() (drops WS)
      DoubaoE2eClient.open({ systemPrompt, voice })
        invoke e2e_open → Rust connect + send StartSession
  → Mic chunks now flow: MicCapture → AudioRouter('e2e') → E2eClient.sendAudio → invoke → Rust → WS
  → Rust recv: JSON events → 'e2e://question_transcript' | 'answer_transcript' | 'turn_end'
                binary PCM   → 'e2e://audio' (Uint8Array)
  → TS E2eClient emits → QaHandoff handlers
  → 'audio' chunks queued into AudioContext via AudioBufferSourceNode.start(when)
  → 'turn_end' → QaHandoff.finish()
      DoubaoE2eClient.close()
      AudioRouter.switchTo('asr')
      VolcanoAsrClient.start() (re-opens WS)
      Persistence.writeAiExchanges (append)
```

### Path 3: End meeting → minutes → export

```
User clicks End
  → MeetingSession.stop()
      MicCapture.stop()
      VolcanoAsrClient.stop()
      SummaryScheduler.stop()
      DoubaoLlmClient.complete(minutesPrompt)  // real Ark call now
      MinutesRenderer.build(summaries, exchanges, decisions, actions)
      Persistence.writeMinutes(md)
  → App transitions to idle
  → ExportModal opens with preview
  → User clicks Download → tauri-plugin-dialog saves .md
```

## Error handling

### Typed WS error envelope

Rust emits on `asr://error` / `e2e://error`:

```json
{ "kind": "auth" | "network" | "rate_limit" | "server" | "protocol",
  "message": "…",
  "retryable": true }
```

- `auth`: 401 / 403 on handshake or server JSON `code==401` — non-retryable, surfaces as "Check credentials in Settings".
- `network`: connect timeout, DNS fail, socket closed without close frame — retryable.
- `rate_limit`: server JSON `code==429` — retryable with backoff (fits state machine).
- `server`: any 5xx — retryable.
- `protocol`: malformed frame, unexpected message type — non-retryable (bug).

`MeetingSession` routes retryable → reconnect state machine; non-retryable → immediate `paused` with reason. UI shows reason in a small toast + sidebar pill.

### Mic permission denial

On first `getUserMedia` the OS shows its native prompt. If denied:
- `MicCapture.start()` rejects with `PermissionDeniedError`.
- `useMeetingSession.startMeeting()` catches, sets state to `idle` with `lastError: 'mic_denied'`.
- `IdleView` shows a permission help card with an "Open System Settings" button (macOS: `tauri-plugin-shell` opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`; Windows: `ms-settings:privacy-microphone`).

### Doubao Ark errors during meeting

- LLM 429 during a summary tick → `SummaryScheduler` skips the tick (existing M1 behavior), retries next interval. No user-visible error.
- LLM 5xx or network during End-of-meeting minutes → `MinutesRenderer` emits fallback markdown line (existing M1 behavior: `(minutes generation unavailable — summaries preserved below)`) + saves what we have. Export still works.
- LLM 401 on any call → single toast "Doubao API key rejected; re-check in Settings", session continues without summaries.

## Testing strategy

### Pure TS (Vitest + DI fakes)

New:
- `src/audio/MicCapture.test.ts` — uses a `FakeAudioContext` and scripted Float32 input; asserts downsample math on a known sine (RMS within tolerance), chunk cadence, RMS cadence, clean stop.
- `src/logic/AudioRouter.test.ts` — feed → active sink receives, inactive sink doesn't; switch is atomic (chunks before switch go to old sink, after switch go to new, none lost in ordering).
- `src/adapters/DoubaoLlmClient.test.ts` — `vi.stubGlobal('fetch', …)` covers: happy path shape, 401 → `{ ok: false }`, 429 → typed error, stream SSE yields chunks, network fail → typed error.

Extended:
- `src/logic/MeetingSession.test.ts` — adds reconnect cases (retryable error → reconnecting → open, exhaust → paused, resume from paused → reconnecting). Uses `FakeClock` to collapse backoff.
- `src/logic/QaHandoff.test.ts` — asserts the new `AudioRouter.switchTo` call order.
- `src/logic/__fakes__/FakeAsrClient.ts` / `FakeE2eClient.ts` — implement `sendAudio`, `emitError({ retryable })`.

No new React tests for WS state. `Orb.test.tsx` extended to assert the amplitude prop drives a rendered CSS var / class.

### Rust (cargo test)

Unit:
- `volcano_ws::frame::decode_response` — parses a fixture SAUC server JSON, returns a typed `AsrEvent`.
- `e2e_ws::frame::decode_event` — parses StartSessionAck, question/answer transcripts, turn_end, binary PCM header.
- `prevent_sleep::windows` — smoke test under `#[cfg(windows)]` that the FFI call returns non-zero.

Integration (feature-gated `--features ws-integration`):
- `src-tauri/tests/ws_bridge.rs` — spins up `tokio-tungstenite::accept_async` on a random port, directs `asr_start` at it, asserts: handshake headers present, audio frames arrive, server-emitted partial events round-trip into Tauri events, clean shutdown. Same pattern for E2E.

CI runs default `cargo test`; integration tests run via `pnpm test:ws` locally.

### Manual smoke — `docs/manual-smoke-m2.md`

1. First launch → mic permission prompt → grant.
2. Settings → enter Volcano App ID + Access Key + Doubao API key → each Test button green OK within 2 s.
3. Start real ~10 min meeting → ≥1 summary card appears.
4. Say wake word mid-meeting → Orb enters listening state → speak question → hear TTS answer → return to passive listening.
5. Toggle Wi-Fi off for 4 s during meeting → yellow Reconnecting pill → restore Wi-Fi → green, no lost finals.
6. End meeting → minutes render → Export → open .md in Preview / Notepad.
7. macOS: close lid or let display sleep → audio still flowing, session still active.
8. Windows: same as 7.

## Open / deferred

- **Fixture FakeClock fix** — not in M2. Documented quirk. Addressed when we touch the dev demo again.
- **Linux packaging** — out of M2.
- **Resume on paused** — UI surface stubbed (clickable red pill), flow exists; if reconnect keeps failing, session is user-terminable but the meeting stays persisted.
- **Multiple simultaneous meetings** — not supported (single meeting at a time by design, enforced by `MeetingSession` singleton usage in App).
- **Settings UX for LLM model override** — hardcoded to `doubao-1-5-pro-256k` in M2. User override deferred.
