# Meeting Copilot — MVP Spec

## One-Liner

A desktop app (Tauri) that sits in the meeting room, continuously listens to the discussion, provides rolling topic summaries, and answers voice questions on demand — combining Doubao's conversational intelligence, Feishu's smart meeting minutes, and wake-word activation.

---

## Problem

In offline meetings, when someone needs AI help — looking up data, checking facts, brainstorming — they have to:

1. Pull out their phone / open a browser
2. Type out the full context of what's being discussed
3. Wait for a response
4. Read it aloud to the group

The AI could have just been listening the whole time.

---

## Solution

An always-listening AI participant for physical meeting rooms. Launch the app, press "Start Meeting", and place the device on the table. The AI listens continuously, generates rolling topic summaries, and responds to voice questions with full awareness of the discussion context. As a native desktop app it holds the microphone session across screen lock, tab switches, and long sessions — none of which a browser tab can guarantee.

---

## Core Interaction Flow

```
Launch → Idle → Start Meeting → Continuous STT → Rolling Summaries → Wake Word → Voice Q&A
       ↑                                                                                │
       └─────────── End Meeting → Persist to history → Reopen any time ────────────────┘
```

### Step by step:

0. **Idle (no meeting)** — On launch, the main pane shows an "idle" view: big orb, "No meeting in progress", a Start button, and keyboard-shortcut hint (⌘⇧N / Ctrl+Shift+N). The sidebar lists past meetings and is always visible.
1. **Start Meeting** — User clicks the sidebar's Start button (or ⌘⇧N). The app asks for microphone permission on the very first run, then recording begins.
2. **Continuous Listening** — Real-time STT runs throughout. The bottom of the screen shows the current sentence being spoken (a single line, not a full transcript) to indicate the system is working.
3. **Rolling Summaries** — Every ~5 minutes, the system generates a topic-aware summary segment. The LLM decides whether to start a new segment or update the current one based on topic continuity. These summary cards stack vertically in the main content area.
4. **Wake Word Activation** — When the wake word is detected in the transcript stream, the AI enters active mode.
5. **Voice Response** — The AI takes the question + full discussion context (rolling summaries + recent raw transcript), generates an answer via LLM, and speaks it aloud via TTS. The response also appears as a chat bubble on screen.
6. **Return to Listening** — After responding, the AI returns to passive listening mode.
7. **End Meeting** — User clicks "End Meeting". The system generates a final meeting minutes document + full transcript, **writes them to local disk as part of the meeting history**, and offers an optional "Export Markdown" download. The app returns to the idle view; the ended meeting now appears at the top of the sidebar history.
8. **Reopen a past meeting** — Clicking any history item in the sidebar opens that meeting in a read-only view (same summary-card layout, no live transcript bar, no orb). Re-export is always available from there.

---

## UI Layout

Native macOS-style window with a left sidebar + main pane.

### In-meeting

```
┌────────────────────────────────────────────────────────────────┐
│ ● ● ●         SuperNono · session/mtg_8f3a                     │ ← titlebar
├──────────────┬─────────────────────────────────────────────────┤
│              │ ● REC 00:23:12   Q2 strategy review    ⚙  End  │ ← main toolbar
│  SuperNono   ├─────────────────────────────────────────────────┤
│  v0.9.2      │                                                 │
│              │   Summary Card: 14:00 - 14:06                   │
│  [● Rec…]    │   "Q1 retention data — onboarding step 2"       │
│              │                                                 │
│  HISTORY  8  │   Summary Card: 14:06 - 14:13                   │
│ ┌──────────┐ │   "New markets: SEA vs. Japan"                  │
│ │ Q2 strat │ │                                                 │
│ │ today·42m│ │          ┌─────────────────────────────┐        │
│ ├──────────┤ │          │  Captured question          │        │
│ │ Design…  │ │          │  AI answer + sources        │        │
│ │ 昨日·58m │ │          └─────────────────────────────┘        │
│ ├──────────┤ │                                                 │
│ │  …       │ │   Summary Card: 14:13 - 14:19 (building…)       │
│ └──────────┘ │                                                 │
│              ├─────────────────────────────────────────────────┤
│ ☾ Dark       │  ▮▮▮▁ Listening   "…focus on SEA first"   kbd   │ ← status bar
│ ⚙ Settings   │                                                 │
└──────────────┴─────────────────────────────────────────────────┘
```

### Idle (no meeting)

```
┌────────────────────────────────────────────────────────────────┐
│ ● ● ●         SuperNono                                        │
├──────────────┬─────────────────────────────────────────────────┤
│  SuperNono   │                                                 │
│  v0.9.2      │                    ▮▮▮▁▁▁                       │
│              │                  (ambient orb)                  │
│  [Start ⌘⇧N] │                                                 │
│              │         No meeting in progress                  │
│  HISTORY  8  │  Start a session and SuperNono will listen,     │
│ ┌──────────┐ │  summarise, and answer questions on demand.     │
│ │ past 1   │ │                                                 │
│ │ past 2   │ │              [ ● Start meeting ]                │
│ │ …        │ │                                                 │
│ └──────────┘ │    ⌘⇧N Start  ·  Say "嘿 Nono" to ask            │
│              │                                                 │
│ ☾ Dark  ⚙    │                                                 │
└──────────────┴─────────────────────────────────────────────────┘
```

### Key UI Elements

**Window chrome** — Custom macOS-style titlebar with traffic lights (close/minimize/maximize) wired to real Tauri window commands. Draggable region spans the whole titlebar.

**Sidebar (left, ~240px, always visible)** — Contains:
- Brand mark + version
- Start meeting / Recording state button (the same button becomes the live "Recording · <title>" indicator during a meeting)
- History list: scrollable, most-recent first, each item shows title, date label, duration, tag. Active (currently-recording) meeting has a live pip. Selected item is highlighted.
- Footer: theme toggle, Settings shortcut (opens the same modal as the in-meeting ⚙ button)

**Main pane** — Holds one of three views:
- **Idle** — big orb, heading, Start button, keyboard-shortcut hint
- **Live meeting** — toolbar (REC timer + meeting title + Settings + End meeting) on top, scrollable column of summary cards + AI exchange blocks in the middle, live transcript / orb / wake-word hint at the bottom (status bar)
- **Past meeting (read-only)** — same summary-card layout, no status bar, a "Re-export" button in the toolbar

**Main Area** — Scrollable stack of summary cards, ordered chronologically. AI response blocks appear inline between summary cards at the point in the timeline when they occurred.

**Status Bar (in-meeting only, ~80px)** — Shows state chip + orb + most recent spoken sentence (single line, auto-updating) + wake-word kbd hint.

**The AI Orb** — A waveform/audio-meter visualization in the status bar. Visual states:
- **Idle / Listening** — Low, slow rolling ripple across bars. The system is passively listening.
- **Activated** — Sharp symmetrical spike, accent-colored glow. Wake word detected.
- **Thinking** — Traveling shimmer pulse, warning-colored. LLM generating.
- **Speaking** — Articulated multi-sinusoid wave, accent-colored. TTS playing.

**Speaker Identification** — Summary cards and transcript attribution include speaker labels (e.g., "Speaker 1", "Speaker 2") if the STT service supports diarization natively.

**Keyboard shortcuts**
- `⌘⇧N` / `Ctrl+Shift+N` — Start meeting (from idle) / focus the recording view (from in-meeting)
- `⌘,` / `Ctrl+,` — Open Settings
- `Esc` — Close any open modal

---

## Settings

Accessible from the sidebar footer (idle or in-meeting) or the in-pane gear icon. Includes:

- **Microphone** — Select input device + test (live level meter).
- **Speaker** — Select output device + test (play sample audio).
- **Wake Word** — Text input to customize the wake word (default TBD). Matched via string detection in STT output.
- **Volcano App ID** — From the Volcano Engine console. Required for ASR authentication.
- **Volcano Access Key** — From the Volcano Engine console. Required for ASR authentication.
- **Doubao API Key** — For LLM (summaries + Q&A) and TTS via the Ark HTTP API. Eliminates the need for payment infrastructure in MVP.
- **Language** — Chinese (primary), English (secondary). MVP can be Chinese-only.

All credentials are persisted in the **OS keychain** (macOS Keychain / Windows Credential Manager), not in plaintext files, not in localStorage. Each credential field can be cleared or re-entered at any time.

---

## Summary Generation Logic

Every 5 minutes, a timer triggers a summary check:

1. Collect all raw transcript text since the last summary.
2. Send to LLM with the previous summary card's content.
3. Prompt: "Given the previous discussion topic and the new transcript, determine: (a) Has the topic changed significantly? If yes, create a new summary segment. If no, update/extend the current segment. (b) Provide a concise summary (2-4 sentences) with a topic title."
4. Render the result as a new card or update the existing card.

This produces natural topic-based segmentation without requiring a separate topic detection model.

---

## Wake Word + Q&A Flow

1. STT runs continuously, producing text.
2. On each transcript segment, check if the configured wake word appears.
3. When detected:
   - Transition orb to "Activated" state.
   - Collect subsequent speech until a pause (silence detection, e.g., 2 seconds of no speech).
   - This captured speech is the user's question.
4. Construct LLM prompt:
   - System: "You are an AI assistant participating in a meeting. Below is the discussion context."
   - Context: All summary cards + the last N minutes of raw transcript.
   - User: The captured question.
5. Stream LLM response.
6. Play response via TTS. Display as a chat bubble in the timeline.
7. Return orb to Idle.

---

## Meeting History & Export

### On "End Meeting"

1. Send all summary cards + full raw transcript to LLM.
2. Generate a structured meeting minutes document:
   - Meeting date & duration
   - Attendees (speaker count)
   - Agenda / topics discussed (derived from summary cards)
   - Key decisions
   - Action items
   - Full transcript (appendix)
3. **Persist to local disk** under the app's data directory (see layout below). This is automatic — no user confirmation required. From this moment the meeting is visible in the sidebar history.
4. Offer an **"Export Markdown"** button on the export modal that writes the same document out to a user-chosen location (e.g. `~/Downloads/Q2-strategy-review.md`). The file is identical to the stored copy.

### On-disk layout

```
<app-data-dir>/SuperNono/
  meetings/
    <meeting-id>/
      meeting.json      ← metadata: id, title, started_at, ended_at, duration,
                          speaker_count, tag (auto-inferred), active_summary_index
      summaries.json    ← the summary cards (time, topic, text, speakers[], state)
      transcript.jsonl  ← one line per ASR utterance: {t, speaker, text, final}
      minutes.md        ← the generated markdown document (the same file shown
                          in the export modal and re-exportable)
      ai-exchanges.json ← captured wake-word Q&A exchanges (question, answer,
                          cites, timestamp)
```

- `<app-data-dir>` is resolved via Tauri's `@tauri-apps/api/path.appDataDir()` — platform-specific (`~/Library/Application Support/SuperNono` on macOS, `%APPDATA%\SuperNono` on Windows).
- Meeting ID format: `mtg_<8 lowercase hex chars>` (matches the design). Generated on Start Meeting.
- Writes during the meeting are **append-only and crash-safe** — `transcript.jsonl` is appended per utterance; `summaries.json` is rewritten atomically whenever a summary card finalizes. A crashed mid-meeting session is recoverable to whatever was last flushed.
- Tag is inferred from the meeting title via a short LLM classification call at end time (or defaults to "General" if offline); it shows as the chip in the sidebar item.

### Sidebar history

- Lists every meeting under `meetings/` ordered by `started_at` descending.
- Each item shows title, relative date (e.g. `今天 · 14:00`, `昨天`, `周一`, or absolute `4月12日`), duration, and tag chip.
- The currently-recording meeting (if any) is rendered with a pulsing live pip in place of the tag.
- Selecting a past meeting opens it in a read-only view reusing the same `SummaryCard` + `AiBlock` components.

### Stretch goals (not blocking MVP)

- Raw audio capture alongside `transcript.jsonl` for later re-transcription.
- Rename / delete meeting from the sidebar context menu.
- Search across past meetings (title + transcript).

---

## Technical Architecture

```
Tauri Desktop App
  ├── Webview (React + TypeScript)
  │     ├── UI (sidebar, idle/meeting/past views, summary cards, status bar,
  │     │     orb, modals, native-style titlebar with traffic lights)
  │     ├── Microphone capture (Web Audio API / MediaRecorder in webview)
  │     ├── Wake-word detection (string match on transcript stream)
  │     ├── Summary scheduler (~5 min timer → LLM)
  │     ├── Q&A orchestration (wake word → capture → LLM → TTS)
  │     ├── TTS playback (HTMLAudioElement, from Doubao/Volcano TTS HTTP API)
  │     ├── Meeting persistence orchestration (what to write, when)
  │     └── Meeting history indexing & rendering
  └── Rust core (Tauri commands)
        ├── Volcano ASR WebSocket client (custom headers, binary framing)
        ├── OS keychain for API credentials (App ID, Access Key, Doubao key)
        ├── Prevent-sleep / power management
        ├── Window controls (traffic-light close/minimize/maximize)
        ├── Global shortcut (⌘⇧N / Ctrl+Shift+N → start meeting)
        └── Filesystem: app data dir, meeting read/write/list, Markdown export
```

The split is deliberate: all product logic lives in TypeScript (unit-testable, no Rust mocks needed), and Rust handles only what the webview cannot — custom WebSocket headers, OS-level audio session stability, keychain, filesystem, native window controls, and global shortcuts.

### API Dependencies

| Capability | Provider | API |
|-----------|----------|-----|
| Real-time STT | Volcano Engine | Streaming ASR (WebSocket) |
| Speaker Diarization | Volcano Engine | Built into ASR if supported, otherwise skip in MVP |
| LLM (summaries + Q&A) | Doubao | Volcano Engine Ark API |
| TTS | Doubao / Volcano Engine | Streaming TTS API |

### Key Technical Decisions

- **Desktop-native (Tauri)**: Chosen over browser because an always-listening meeting device can't tolerate tab backgrounding, screen lock, or per-tab mic permission fragility. Tauri also lets us set custom WebSocket headers for Volcano auth — browsers cannot.
- **No backend server**: The Rust side of Tauri is not a server; it's an in-process bridge. All calls go directly from the user's machine to Volcano/Doubao with the user's own credentials.
- **User-supplied credentials**: App ID, Access Key, and Doubao key are entered in Settings and persisted in the OS keychain (Keychain on macOS, Credential Manager on Windows). Not in plaintext files, not in localStorage.
- **No local models**: All intelligence runs via cloud APIs. The app is a thin client.
- **Local-only meeting history**: Past meetings are persisted to the app's data directory on disk. No cloud sync, no account system, no server ever sees the data. This is a deliberate privacy posture, not a stepping stone to cloud.
- **Wake word via transcript matching**: No separate keyword spotting model. The STT stream is already running — just do string matching. Simple, zero additional cost.
- **Logic in TypeScript, transport in Rust**: All product logic (wake-word detection, transcript buffering, summary scheduling, prompt building, markdown export) lives in pure TS and is unit-testable with no Tauri/Rust mocks. Rust owns only what the webview can't do: Volcano WS with headers, keychain, prevent-sleep, file save.

---

## Explicitly Out of Scope (MVP)

- ❌ Cloud sync / user accounts / login
- ❌ Multi-device support
- ❌ Custom knowledge base / RAG / document upload
- ❌ Hardware integration
- ❌ Payment / billing / subscription
- ❌ Mobile app
- ❌ Multi-language in same meeting
- ❌ Meeting scheduling / calendar integration
- ❌ Real-time collaborative editing of notes
- ❌ Audio recording / playback (stretch goal)
- ❌ Advanced noise cancellation beyond what the STT API handles

---

## Future Roadmap (Post-MVP)

1. **History search & organisation** — Full-text search across past meeting transcripts; rename, delete, and tag from the sidebar.
2. **Background / system-tray listening** — Start recording from a global hotkey or tray menu without opening the main window.
3. **System-level wake-word spotting** — Run a lightweight keyword model locally to cut ASR cost during idle periods.
4. **Custom knowledge base** — Upload company docs, product specs, etc. RAG integration so the AI can answer domain-specific questions.
5. **Hardware product** — Dedicated meeting room device (tablet/speaker form factor) with far-field microphone array, always-on, zero-setup.
6. **Team features** — Shared meeting notes, action item tracking, integration with project management tools.
7. **Multi-language** — Real-time translation for cross-language meetings.
8. **Audio capture & re-transcription** — Store raw audio alongside transcripts so history items can be re-run with a better model later.

---

## Success Criteria (MVP)

The MVP is successful if:

1. A group of 3-5 people can have a 30-minute meeting with the app running.
2. The rolling summaries accurately capture the main discussion topics.
3. A participant can say the wake word, ask a question about what was just discussed, and receive a relevant spoken answer within 5 seconds.
4. The exported meeting minutes are useful enough that someone who missed the meeting can understand what happened.
5. After a meeting ends, it appears in the sidebar history, can be reopened in a read-only view, and can be re-exported to Markdown — across app restarts.
6. The app survives the intended usage pattern: screen lock, window unfocus, and a 60+ minute continuous session without losing the audio stream or crashing.

---

## Open Questions

- [ ] What should the default wake word be? (Needs to be distinctive enough to avoid false triggers in natural conversation, but natural enough to say out loud in a meeting.)
- [ ] Volcano Engine ASR — does the streaming API support speaker diarization out of the box, or does it require a separate post-processing step?
- [ ] TTS latency — is Doubao's streaming TTS fast enough for the "answer within 5 seconds" target, or do we need to consider alternative TTS providers?
- [ ] Tauri mic access — verify `getUserMedia` behaves the same inside the Tauri webview (WebKit on macOS, WebView2 on Windows) across long sessions; add an explicit prevent-sleep call on meeting start.
- [ ] Context window management — for a 2-hour meeting, how do we keep the LLM context within token limits? Rolling summaries help, but we need to define the exact truncation strategy.
- [ ] History storage format versioning — `meeting.json` / `summaries.json` schema versioning so later releases can migrate old meetings without loss.
- [ ] Mid-meeting crash recovery — on launch, detect an in-progress meeting folder (no `ended_at`) and offer to resume or finalize it as-is.
