# SuperNono — Design Doc

**Status:** Approved for implementation planning
**Date:** 2026-04-19
**Scope:** MVP only (v1). Post-MVP ideas are collected in a dedicated section, not mixed into v1 scope.
**Reference:** Product spec at `docs/SPEC.md`. Design prototype at `docs/nono-design/nono/project/`. Volcano Engine API docs at `docs/volcano/`.

---

## 1. Product context (one paragraph)

SuperNono is a Tauri desktop app that sits on a meeting-room table, listens continuously, produces rolling topic summaries, answers voice questions on wake-word, and persists every meeting locally. The product spec is authoritative for *what* we're building. This doc is authoritative for *how* — the architecture, module boundaries, data flow, testing, milestones, and all the decisions that were open at the top of the spec.

---

## 2. Stack & toolchain

- **Tauri 2** (stable since Nov 2024). Plugins used: `fs`, `shell`, `global-shortcut`, `window`.
- **Frontend:** React 18 + TypeScript + Vite (Tauri's default template).
- **Package manager:** pnpm. Deterministic lockfile, fast on macOS, fewer native-module quirks than Bun for Tauri workflows.
- **Rust:** stable toolchain. Crates: `tokio`, `tokio-tungstenite` (custom WebSocket headers — the whole reason we need Rust), `keyring` (OS keychain), `serde`/`serde_json` (IPC payloads), `objc2` (macOS prevent-sleep), `log`+`env_logger`.
- **Testing:**
  - TS unit + integration: Vitest.
  - Rust unit: `cargo test`.
  - End-to-end across the Tauri boundary: manual checklist in M2. No automated Tauri-harness in MVP.
- **Lint/format:** ESLint + Prettier (TS); `cargo fmt` + `cargo clippy` (Rust). Pre-commit hook runs lint + changed-file unit tests.
- **Discipline:** Test-first (red → green → refactor) for anything under `src/logic/`. Not dogmatic for React components, Rust bridges, or adapter code — test where the failure mode matters.

---

## 3. Top-level architecture

```
┌────────────────────────────────── Tauri process ──────────────────────────────────┐
│                                                                                    │
│  ┌───────────── Webview (React + TS) ─────────────┐   ┌────── Rust core ──────┐  │
│  │                                                 │   │                       │  │
│  │  UI layer (pure presentational React)          │   │  volcano_ws          │  │
│  │   Sidebar · Idle · Meeting · Past · Modals     │   │   (WS + binary frames)│  │
│  │   Orb · SummaryCard · AiBlock · LiveTranscript │   │                       │  │
│  │                                                 │   │  e2e_ws              │  │
│  │  ─────── React ↔ logic bridge (hooks) ──────   │   │   (Doubao Realtime WS)│  │
│  │   useMeetingSession() · useHistory()           │   │                       │  │
│  │   useTheme() · useKeychain() · useSettings()   │   │  keychain            │  │
│  │                                                 │   │   (get/set/clear)     │  │
│  │  ─────── Product logic (pure TS) ───────────   │   │                       │  │
│  │   MeetingSession (long-lived)                  │   │  meeting_fs          │  │
│  │   WakeWordMatcher · SummaryScheduler           │   │   (list/read/write/   │  │
│  │   TranscriptBuffer · QaHandoff                 │   │    atomic/append)     │  │
│  │   MinutesRenderer · HistoryIndex · config      │   │                       │  │
│  │                                                 │   │  window_controls     │  │
│  │  ─────── Adapters (thin shims) ────────────    │   │   (close/min/max)     │  │
│  │   DoubaoLlmClient (fetch)                      │   │                       │  │
│  │   DoubaoE2eClient (→ Rust events)              │   │  global_shortcut     │  │
│  │   VolcanoAsrClient (→ Rust events)             │   │   (⌘⇧N)               │  │
│  │   FsAdapter · KeychainAdapter (→ Rust invoke)  │   │                       │  │
│  │   AudioCapture (MediaRecorder / AudioWorklet)  │   │  prevent_sleep       │  │
│  │                                                 │   │                       │  │
│  └─────────────────────────────────────────────────┘   └───────────────────────┘  │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘

                      ↓ egress (direct, no intermediary) ↓
    Volcano ASR (WS, Rust)   Doubao LLM (HTTPS, TS)   Doubao Realtime (WS, Rust)
```

**Three TS layers:**

1. **UI** — React components that take props and render. No fetch, no timers, no business logic. Directly derived from the design prototype.
2. **Product logic** — pure TS, no React/DOM/fetch/Tauri imports. Dependencies injected through adapter interfaces. Tested with Vitest.
3. **Adapters** — the only files that know about `@tauri-apps/api`, `fetch`, `HTMLAudioElement`, `MediaRecorder`. Implement the interfaces defined in product-logic.

**Rust is narrow on purpose.** Seven commands. No business logic — if it can live in TS, it lives in TS. Rust exists because browsers can't set custom WebSocket headers, touch the OS keychain, do native window chrome, or register global shortcuts.

**IPC topology.** TS → Rust is always `invoke()` (request/response). Rust → TS is Tauri events, only for streams (ASR transcripts, E2E transcripts+audio, global-shortcut firings). Session IDs are TS-generated strings passed as opaque handles; no shared state between sides beyond those.

---

## 4. TS product-logic modules

All under `src/logic/`. Each ≤~250 lines. No React, no DOM, no Tauri imports.

### Adapter interfaces

```ts
interface AsrClient {
  start(opts: AsrOpts): Promise<void>;
  stop(): Promise<void>;
  on(event: 'partial' | 'final' | 'error' | 'closed',
     cb: (payload: Utterance | Error) => void): Unsubscribe;
}

interface E2eClient {
  open(opts: { systemPrompt: string; voice: string }): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  on(event: 'audio' | 'question_transcript' | 'answer_transcript' | 'turn_end' | 'error',
     cb: (payload: unknown) => void): Unsubscribe;
  close(): Promise<void>;
}

interface LlmClient {
  complete(req: LlmReq): Promise<LlmResp>;
  stream(req: LlmReq): AsyncIterable<LlmChunk>;
}

interface Persistence {
  createMeeting(meta: MeetingMeta): Promise<void>;            // atomic
  appendUtterance(mtgId: string, u: Utterance): Promise<void>; // append + fsync
  writeSummaries(mtgId: string, s: Summary[]): Promise<void>;  // atomic
  writeMeta(mtgId: string, m: MeetingMeta): Promise<void>;     // atomic
  writeMinutes(mtgId: string, md: string): Promise<void>;      // atomic
  writeAiExchanges(mtgId: string, exs: AiExchange[]): Promise<void>; // atomic
  listMeetings(): Promise<MeetingMeta[]>;
  readMeeting(mtgId: string): Promise<FullMeeting>;
}

interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Handle;
  clearTimeout(h: Handle): void;
}
```

### Modules

- **`MeetingSession`** — the long-lived object. Constructor takes `{ asr, e2e, llm, persistence, clock, config }`. Methods: `start()`, `stop()`. Owns child modules, routes events, writes to persistence. Emits: `transcript`, `summary`, `qa`, `orbState`, `error`.

- **`TranscriptBuffer`** — appends finals, bounded memory (drops old partials, keeps all finals). Queries: `sinceTimestamp(t)`, `lastNMinutes(n)`, `sinceLastSummary(t)`.

- **`SummaryScheduler`** — 5-minute tick via injected `Clock`. On tick: pulls `sinceLastSummary`, calls `llm.complete` with spec's "same-topic-or-new?" prompt, emits `summary` event. Retry-once-then-skip on LLM failure.

- **`WakeWordMatcher`** — substring match on finals only (not partials). On match: emits `orbState=activated`, hands off to `QaHandoff`.

- **`QaHandoff`** — owns the wake-word Q&A lifecycle:
  1. On activation, pauses ASR (`asr.stop()`).
  2. Builds the E2E system prompt: persona + all summaries + `TranscriptBuffer.lastNMinutes(2)`.
  3. Opens E2E WS with that prompt.
  4. Routes mic audio to E2E.
  5. Listens for E2E events: `question_transcript`, `audio` chunks (plays via `HTMLAudioElement`), `answer_transcript`, `turn_end`.
  6. On `turn_end`: closes E2E, resumes ASR, appends two pseudo-utterances to `transcript.jsonl` (`speaker: "User (to Nono)"`, `speaker: "SuperNono"`), atomically rewrites `ai-exchanges.json` with the new exchange added, emits `orbState=idle`.
  7. Interruption: the E2E service owns turn detection and interruption (its native capability per `docs/volcano/e2e-interaction-intro.md`). Our job is to respect whatever `turn_end`-shaped event it emits and react accordingly — close session, resume ASR. We do **not** run ASR in parallel to detect interruption.

- **`MinutesRenderer`** — pure function: `(summaries, transcript, meta) → string`. Calls `llm.complete` once with a structured prompt, assembles markdown per spec Section "Meeting History & Export". Also used for re-export.

- **`HistoryIndex`** — `list()`, `open(id)`, `crashRecoveryScan()`. Pure functions over `Persistence`.

- **`config/`** — typed constants: `SUMMARY_INTERVAL_MS = 5*60*1000`, `SILENCE_TIMEOUT_MS = 2000`, `MAX_RAW_WINDOW_MIN_SUMMARY = 5`, `MAX_RAW_WINDOW_MIN_QA = 2`, `MAX_CONTEXT_CHARS = 8000`, `DEFAULT_WAKE_WORD = '嘿 Nono'`, `DEFAULT_LANG = 'zh'`.

### Fakes for tests

`FakeAsrClient` (scripted event emit), `FakeE2eClient` (scripted audio+text emit), `FakeLlmClient` (prompt→response registry), `InMemoryPersistence` (Map-backed), `FakeClock` (manually advanceable). All live under `src/logic/__fakes__/`.

---

## 5. Rust bridges

Seven modules under `src-tauri/src/commands/`.

### `keychain.rs`

```rust
#[tauri::command] async fn keychain_get(key: String) -> Result<Option<String>>;
#[tauri::command] async fn keychain_set(key: String, value: String) -> Result<()>;
#[tauri::command] async fn keychain_delete(key: String) -> Result<()>;
```

Service name: `com.supernono.app`. Keys: `volcano_app_id`, `volcano_access_key`, `doubao_api_key`. Uses `keyring` crate.

### `meeting_fs.rs`

```rust
meeting_create(id, meta) -> ();               // writes meeting.json atomically
meeting_append_utterance(id, line) -> ();     // append + fsync on transcript.jsonl
meeting_write_summaries(id, json) -> ();      // tmp + fsync + rename
meeting_write_minutes(id, md) -> ();          // tmp + fsync + rename
meeting_write_ai_exchanges(id, json) -> ();   // tmp + fsync + rename
meeting_list() -> Vec<MeetingMeta>;           // scans <appDataDir>/SuperNono/meetings/
meeting_read(id) -> FullMeeting;              // loads all files
meeting_export_md(id, dest_path) -> ();       // copy stored minutes.md to user path
```

All paths resolved via `tauri::path::app_data_dir`. Atomic writes use the tmp+fsync+rename dance. Appends use `OpenOptions::append` + `write_all` + `fsync`. No in-memory state held between calls.

### `volcano_ws.rs` — the module that justifies Rust

```rust
asr_start(session_id, app_id, access_key, params) -> ();
asr_send_audio(session_id, pcm_chunk: Vec<u8>) -> ();
asr_stop(session_id) -> ();
```

Opens a WebSocket to Volcano's streaming-ASR endpoint with custom auth headers (impossible from a browser). Parses Volcano's binary frame protocol per `docs/volcano/asr-stream-api.md`. Emits Tauri events `asr://partial`, `asr://final`, `asr://error`, `asr://closed`. Uses `tokio-tungstenite`. One task per session_id, tracked in `Arc<Mutex<HashMap<SessionId, AsrTask>>>`.

### `e2e_ws.rs`

```rust
e2e_open(session_id, token, system_prompt, voice) -> ();
e2e_send_audio(session_id, pcm_chunk: Vec<u8>) -> ();
e2e_close(session_id) -> ();
```

Doubao Realtime WebSocket (`docs/volcano/e2e-interaction-api.md`). PCM-in, PCM-out. Emits `e2e://question_transcript`, `e2e://answer_transcript`, `e2e://audio` (binary), `e2e://turn_end`, `e2e://error`. Same task-per-session shape as `volcano_ws`.

### `window_controls.rs`

`window_close()`, `window_minimize()`, `window_toggle_maximize()` — wired to the prototype's traffic lights. Draggable titlebar region is CSS (`-webkit-app-region: drag`), no Rust involvement.

### `global_shortcut.rs`

Registers `CmdOrCtrl+Shift+N` via `tauri-plugin-global-shortcut`. Fires event `shortcut://start-meeting`; TS handles the view switch.

### `prevent_sleep.rs`

```rust
prevent_sleep_enable(reason: String) -> Token;
prevent_sleep_disable(token: Token) -> ();
```

macOS: `IOPMAssertionCreateWithName` via `objc2`. Windows: `SetThreadExecutionState`. Called on Start Meeting, released on End Meeting.

---

## 6. Data flow

### Path A — Listening → Transcript → Summary

```
mic → MediaRecorder (webview) → PCM chunks (~40ms) → Rust asr_send_audio
Volcano ASR → Rust → Tauri event asr://final → VolcanoAsrClient adapter
 → MeetingSession:
     a. TranscriptBuffer.append(u)
     b. persistence.appendUtterance(id, u)       ← fsync, crash-safe
     c. WakeWordMatcher.check(u)
     d. emit 'transcript' → React re-renders LiveTranscript

every 5 min: SummaryScheduler tick:
  a. transcript = TranscriptBuffer.sinceLastSummary()
  b. prompt    = [previous summary] + [transcript] + [same-topic-or-new?]
  c. llm.complete(prompt) → new card OR updated active card
  d. persistence.writeSummaries(id, allSummaries)  ← atomic
  e. emit 'summary' → React re-renders cards
```

### Path B — Wake word → E2E Q&A

```
1. WakeWordMatcher sees DEFAULT_WAKE_WORD in a final utterance
2. orbState = 'activated'
3. QaHandoff.start():
     a. asr.stop()                               ← pause ASR
     b. systemPrompt = [persona] + [all summaries] + [last 2 min raw]
     c. e2e.open({ systemPrompt, voice })
4. mic PCM now routed to e2e.sendAudio(...)
5. E2E → 'question_transcript' → record → log
6. orbState = 'thinking'
7. E2E → 'audio' chunks → HTMLAudioElement plays them as they arrive
   orbState = 'speaking'
8. E2E → 'answer_transcript' → record → render AiBlock
9. E2E emits 'turn_end' (or its interruption signal):
     a. e2e.close()
     b. persistence: append two utterances to transcript.jsonl
        (speaker: "User (to Nono)", speaker: "SuperNono")
        + atomic rewrite of ai-exchanges.json with new exchange added
     c. asr.start() (re-arm)
     d. orbState = 'idle'
```

### Path C — End Meeting

```
1. User clicks End → session.stop()
2. asr.stop() + prevent_sleep_disable()
3. md = MinutesRenderer.render(summaries, transcript, meta)
       (llm.complete once — structured prompt per spec)
4. tag = llm.complete(shortClassificationPrompt(title)) or "General" on fail
5. persistence.writeMinutes(id, md)
   persistence.writeMeta(id, { ...meta, ended_at, tag })
6. Export modal opens with minutes preview
7. Download .md → copies stored minutes.md to user-chosen path
8. Sidebar re-reads history; meeting appears at top, not active
```

### Critical design decisions inside data flow

- **Audio → PCM in webview, not Rust.** `getUserMedia` + `AudioWorklet` produces PCM. Rust receives bytes. Keeps audio-device handling on the platform the webview uses correctly.
- **TTS during Q&A is E2E audio, not a separate TTS call.** E2E returns audio bytes; `HTMLAudioElement` plays them. No separate Doubao TTS HTTP call in MVP.
- **ASR paused during Q&A.** One destination for mic audio at a time. E2E transcripts bridge the record gap in `transcript.jsonl`.
- **Summaries use text LLM (Doubao HTTP), not E2E.** E2E is audio-native; summaries are pure text work and benefit from Doubao Pro reasoning.

---

## 7. Persistence, crash recovery, schema versioning

### On-disk layout

```
<appDataDir>/SuperNono/
  meetings/
    <mtg_xxxxxxxx>/
      meeting.json         {schema_version:1, id, title, started_at, ended_at?,
                            duration?, speaker_count, tag, active_summary_index}
      summaries.json       {schema_version:1, summaries: Summary[]}
      transcript.jsonl     each line: {schema_version:1, t, speaker, text, final}
      minutes.md           plain markdown, generated at End Meeting
      ai-exchanges.json    {schema_version:1, exchanges: AiExchange[]}
```

Meeting IDs: `mtg_` + 8 lowercase hex chars. Generated on Start.

### Write invariants

- **JSON files (meeting, summaries, minutes, ai-exchanges):** write `X.tmp`, `fsync(fd)`, `rename(X.tmp, X)`. Readers never see a partial file.
- **`transcript.jsonl`:** `OpenOptions::append` + `write_all` + `fsync` per utterance. Worst-case loss on crash: ≤1 utterance.
- **No lock files.** One process owns the meeting folder during a session; the session ID is the coordination mechanism.

### Crash recovery

- `meeting.json.ended_at` is the sole liveness marker. Present = finished. Absent = crashed.
- On launch, `HistoryIndex.crashRecoveryScan()` walks `meetings/`, flags any folder with `ended_at` missing.
- UI: if ≥1 crashed meeting exists, show a modal on launch listing them. Two actions per item:
  - **Finalize** — run `MinutesRenderer` on whatever `summaries.json` + `transcript.jsonl` contain, generate `minutes.md`, set `ended_at = last utterance timestamp`, write.
  - **Discard** — delete the folder.
- No "resume recording" — audio state can't be reconstructed; the meeting ended de-facto when the process died.

### Schema versioning

- Every JSON file begins with `"schema_version": 1`.
- `transcript.jsonl` carries `schema_version` on **each line** (cheap; enables future per-line evolution).
- On read, missing `schema_version` is treated as `0` (pre-versioning) and handled best-effort.
- Mismatch (higher than app supports): show a one-line sidebar warning for that meeting, render read-only with a degraded view.
- Migration modules (`migrations/v1-to-v2.ts`) added when a v2 arrives. Not needed for MVP.

---

## 8. Testing strategy

### Pyramid

- **Base — TS unit (Vitest).** Per module in `src/logic/`. Every module's adapters injected; tests use fakes. Full behavioral coverage for `MeetingSession`, `SummaryScheduler`, `WakeWordMatcher`, `QaHandoff`, `TranscriptBuffer`, `MinutesRenderer`, `HistoryIndex`, `config`.
- **Middle — TS integration (Vitest).** Scripted multi-minute fake meetings under `src/logic/__integration__/`. Drives: "does a 15-min fake ASR stream produce expected summary cards, trigger wake word at the right moment, produce a sensible minutes.md?"
- **Narrow — Rust unit (`cargo test`).** Scope: (a) `meeting_fs` round-trip + atomicity on simulated partial writes; (b) `keychain` round-trip against a fake backend (real keychain gated behind `SUPERNONO_RUN_KEYCHAIN_TESTS=1`); (c) `volcano_ws` / `e2e_ws` **frame codec only** — byte-level parser tests with recorded sequences. Full WS integration against a mock server is not MVP-blocking.
- **Tip — Manual E2E.** Written checklist in `docs/manual-test-plan.md`, run once per milestone: start meeting, speak 10 min, verify live transcript, trigger wake word, verify response plays, end meeting, verify `minutes.md` and sidebar history item.

### Fixtures

- `fixtures/asr-transcripts/` — realistic ASR event sequences (JSON). Hand-written initially; can be captured from real runs in M2.
- `fixtures/doubao-responses/` — canned LLM responses keyed by prompt signature. Used by `FakeLlmClient`.

### Discipline

- **Test-first inside `src/logic/`.** Every new behavior starts as a failing test.
- **Not dogmatic elsewhere.** React components that just render props don't need tests. Rust bridges get tests where the failure mode matters (FS atomicity, codec correctness) and smoke tests otherwise.
- **CI-blocking gates:** `pnpm test`, `cargo test`, `pnpm lint`, `pnpm typecheck`, `cargo clippy`.
- **Anti-pattern to avoid:** wrapping the session class in a React renderer for tests. The session class is pure TS; instantiate it directly.

---

## 9. Milestones

### M1 — everything fake-drivable (autonomous)

**Exit criterion:** Launch the app. UI matches the prototype. A hidden dev-only "Replay fixture" control drives a scripted 10-minute meeting end-to-end — summary cards appear on schedule, wake-word triggers a canned Q&A exchange, minutes.md generates, meeting saves to disk, reopens cleanly from the sidebar. All without hitting a single real API.

**Scope:**

- Tauri 2 project scaffold, React + TS + Vite + pnpm.
- ESLint, Prettier, `cargo fmt`, `cargo clippy`, pre-commit hook.
- Full UI port from prototype (Sidebar, Idle, Meeting, Past, Settings modal, Export modal, Orb with all four states, traffic lights, theme toggle).
- Design tokens extracted from `desktop.css`/`app.css` into CSS variables.
- Window chrome wired to real Rust commands (traffic lights, draggable titlebar, `⌘⇧N` global shortcut).
- All TS product-logic modules, test-first, with full fake adapters.
- All Rust bridges implemented and tested, **except** `volcano_ws` and `e2e_ws` connection code — those modules exist with frame codecs and the IPC surface, but their `.connect()` path is stubbed to error.
- Real `meeting_fs` writing real files. Real sidebar history. Crash recovery working against synthetic crashed folders.
- Hidden dev tweaks panel (toggle `⌃⌥D`): force any orb state, force any view, replay any fixture, inspect persistence.

### M1 → M2 handoff

Things the human must provide:

1. **Visual approval (soft).** Open it, compare to the prototype, surface anything off.
2. **Volcano App ID + Access Key.** Entered in Settings, stored in keychain. Unblocks real ASR.
3. **Doubao API key.** Entered in Settings. Unblocks real Doubao LLM and real E2E Realtime.
4. **macOS first-run permissions.** Microphone (and whatever else the OS prompts for).
5. **First real-speech test.** Human launches, speaks into the mic, we see what breaks.

### M2 — swap fakes for real

**Exit criterion:** A 30-minute real meeting produces live transcripts, on-schedule summary cards, a working wake-word Q&A exchange, a saved minutes.md, and a reopen-able history item. Manual test plan passes.

**Scope:**

- Complete `volcano_ws.connect()` against the real Volcano endpoint.
- Complete `e2e_ws.connect()` against the real Doubao endpoint.
- Real mic capture → PCM chunks → Rust ASR (and routable to E2E during Q&A).
- Real `DoubaoLlmClient.complete/stream` calls.
- Debug and polish pass: whatever breaks on contact with reality.
- Fill in `fixtures/asr-transcripts/` with real captures for regression coverage.
- `docs/manual-test-plan.md` walkthrough.

---

## 10. Open questions — resolution table

| Spec open question | MVP resolution |
|---|---|
| Default wake word | `嘿 Nono`; user-editable in Settings |
| Speaker diarization | Native in streaming ASR (`自动说话人分离`); no post-processing |
| TTS latency to meet 5s target | N/A — replaced by E2E Realtime (sub-second turn) for Q&A |
| `getUserMedia` across long sessions | Treat as working; verify empirically in M2; `prevent_sleep_enable` at Start, release at End |
| Context window for 2-hr meetings | Summary cards (always in full) + last 5 min raw (char-capped, front-truncated) for summary prompts; summary cards + last 2 min raw for E2E |
| History storage schema versioning | `"schema_version": 1` as first field of every JSON file and every JSONL line; mismatch → read-only degraded view |
| Mid-meeting crash recovery | On launch, any folder missing `ended_at` gets a **Finalize / Discard** prompt; no "resume recording" |

---

## 11. v2 deferrals (explicit)

These are out of MVP scope and should not leak into v1 implementation:

- **Meeting-notes API upload** — Volcano's offline `auc/lark/submit` pipeline for structured minutes. Requires audio-to-disk plus file hosting; good post-MVP upgrade but deferred.
- **Audio recording to disk** — deferred with meeting-notes upload. Nothing in MVP consumes the audio file.
- **Citations on AI bubbles** — E2E model doesn't produce structured citations; the `cites` slot renders only when data exists.
- **History search, rename, delete** — read-only sidebar in MVP.
- **Background / system-tray listening.**
- **Local wake-word spotting model.**
- **RAG / custom knowledge base.**
- **Multi-language in one meeting.**
- **Cross-device sync / accounts.**
- **Re-transcription from stored audio.**

---

## 12. Repo layout (target, post-M1)

```
/
├── src/                        # TS (React + logic)
│   ├── ui/                     # React components (port of prototype)
│   ├── logic/                  # Pure TS product logic + fakes + tests
│   │   ├── MeetingSession.ts
│   │   ├── TranscriptBuffer.ts
│   │   ├── SummaryScheduler.ts
│   │   ├── WakeWordMatcher.ts
│   │   ├── QaHandoff.ts
│   │   ├── MinutesRenderer.ts
│   │   ├── HistoryIndex.ts
│   │   ├── config/
│   │   ├── __fakes__/
│   │   ├── __integration__/
│   │   └── *.test.ts
│   ├── adapters/               # Tauri/fetch/DOM boundary
│   │   ├── VolcanoAsrClient.ts
│   │   ├── DoubaoE2eClient.ts
│   │   ├── DoubaoLlmClient.ts
│   │   ├── FsAdapter.ts
│   │   ├── KeychainAdapter.ts
│   │   └── AudioCapture.ts
│   └── hooks/                  # React hooks bridging logic → components
├── src-tauri/
│   └── src/
│       ├── commands/
│       │   ├── keychain.rs
│       │   ├── meeting_fs.rs
│       │   ├── volcano_ws.rs
│       │   ├── e2e_ws.rs
│       │   ├── window_controls.rs
│       │   ├── global_shortcut.rs
│       │   └── prevent_sleep.rs
│       └── main.rs
├── fixtures/
│   ├── asr-transcripts/
│   └── doubao-responses/
└── docs/
    ├── SPEC.md
    ├── volcano/
    ├── nono-design/
    ├── manual-test-plan.md        (added in M2)
    └── superpowers/specs/
        └── 2026-04-19-supernono-design.md   (this file)
```

---

## 13. Summary (one screen)

```
STACK        Tauri 2 · React 18 · TS · Vite · pnpm · Vitest · keyring · tokio-tungstenite

TS layers    UI (React, dumb) · Product logic (pure TS, TDD) · Adapters (boundary)

TS logic     MeetingSession, TranscriptBuffer, SummaryScheduler, WakeWordMatcher,
             QaHandoff, MinutesRenderer, HistoryIndex, config

Rust         keychain · meeting_fs · volcano_ws · e2e_ws
             window_controls · global_shortcut · prevent_sleep

APIs (MVP)   Streaming ASR (Volcano) — always-on during meeting
             E2E Realtime (Doubao)   — wake-word Q&A only
             Doubao LLM HTTP         — summary cards + final minutes

APIs (v2+)   Meeting-notes (offline structured minutes)
             Audio-to-disk recording
             Citations in Q&A answers

Storage      <appDataDir>/SuperNono/meetings/<mtg_xxxx>/
             meeting.json · summaries.json · transcript.jsonl · minutes.md · ai-exchanges.json
             All writes: atomic tmp+fsync+rename (JSON) or append+fsync (JSONL)
             schema_version: 1 in every file

Milestones   M1 (autonomous)  — full UI, full TS logic, Rust bridges sans WS .connect(),
                                demo via fixture replay
             M1 → M2 handoff  — visual approval, API keys, mic permission
             M2 (with human)  — real Volcano ASR + Doubao LLM + E2E; debug on real speech

Testing      Vitest unit + integration (fakes + fake clock)
             cargo test (frame codecs, FS atomicity, keychain round-trip)
             Manual checklist in M2
```
