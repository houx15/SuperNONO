# Meeting Copilot — MVP Spec

## One-Liner

A desktop web app that sits in the meeting room, continuously listens to the discussion, provides rolling topic summaries, and answers voice questions on demand — combining Doubao's conversational intelligence, Feishu's smart meeting minutes, and wake-word activation.

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

An always-listening AI participant for physical meeting rooms. Open a web page, press "Start Meeting", and place the device on the table. The AI listens continuously, generates rolling topic summaries, and responds to voice questions with full awareness of the discussion context.

---

## Core Interaction Flow

```
Start Meeting → Continuous STT → Rolling Summaries → Wake Word → Voice Q&A → End Meeting → Export
```

### Step by step:

1. **Start Meeting** — User clicks one button. Recording begins.
2. **Continuous Listening** — Real-time STT runs throughout. The bottom of the screen shows the current sentence being spoken (a single line, not a full transcript) to indicate the system is working.
3. **Rolling Summaries** — Every ~5 minutes, the system generates a topic-aware summary segment. The LLM decides whether to start a new segment or update the current one based on topic continuity. These summary cards stack vertically in the main content area.
4. **Wake Word Activation** — When the wake word is detected in the transcript stream, the AI enters active mode.
5. **Voice Response** — The AI takes the question + full discussion context (rolling summaries + recent raw transcript), generates an answer via LLM, and speaks it aloud via TTS. The response also appears as a chat bubble on screen.
6. **Return to Listening** — After responding, the AI returns to passive listening mode.
7. **End Meeting** — User clicks "End Meeting". The system generates a final meeting minutes document and full transcript, exported as a downloadable file (Markdown).

---

## UI Layout

```
┌──────────────────────────────────────────────────┐
│  [Settings ⚙️]                    [End Meeting]  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │   Summary Card: 10:00 - 10:05              │  │
│  │   "Discussed Q1 revenue targets..."        │  │
│  │                                            │  │
│  │   Summary Card: 10:05 - 10:12              │  │
│  │   "Shifted to hiring plan for..."          │  │
│  │                                            │  │
│  │          ┌─────────────────┐               │  │
│  │          │  AI Response    │               │  │
│  │          │  bubble         │               │  │
│  │          └─────────────────┘               │  │
│  │                                            │  │
│  │   Summary Card: 10:12 - 10:18              │  │
│  │   "Returned to budget allocation..."       │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  "...so I think we should focus on the     │  │
│  │   Southeast Asia market first"             │  │
│  │                                ◉ (AI orb)  │  │
│  │         Say "Hey XX" to ask AI             │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Key UI Elements

**Main Area (top ~80%)** — Scrollable stack of summary cards, ordered chronologically. AI response bubbles appear inline between summary cards at the point in the timeline when they occurred.

**Status Bar (bottom ~20%)** — Shows the most recent spoken sentence (single line, auto-updating). Contains the AI orb and wake word hint.

**The AI Orb** — A semi-transparent sphere at the bottom-right. Visual states:
- **Idle / Listening** — Semi-transparent, subtle breathing animation. The system is passively listening.
- **Activated** — Orb grows and brightens when wake word is detected. Pulsing animation indicates "I'm listening to your question."
- **Thinking** — Swirling / rotating animation while LLM generates response.
- **Speaking** — Orb pulses with the rhythm of TTS playback.
- **Returns to Idle** — Shrinks back to semi-transparent after response completes.

**Speaker Identification** — Summary cards and transcript attribution include speaker labels (e.g., "Speaker 1", "Speaker 2") if the STT service supports diarization natively.

---

## Settings

Accessible via a gear icon. Includes:

- **Microphone** — Select input device + test (live level meter).
- **Speaker** — Select output device + test (play sample audio).
- **Wake Word** — Text input to customize the wake word (default TBD). Matched via string detection in STT output.
- **LLM API Key** — Input field for Doubao / Volcano Engine API key. This eliminates the need for payment infrastructure in MVP.
- **Language** — Chinese (primary), English (secondary). MVP can be Chinese-only.

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

## Meeting Export

On "End Meeting":

1. Send all summary cards + full raw transcript to LLM.
2. Generate a structured meeting minutes document:
   - Meeting date & duration
   - Attendees (speaker count)
   - Agenda / topics discussed (derived from summary cards)
   - Key decisions
   - Action items
   - Full transcript (appendix)
3. Export as downloadable Markdown file.
4. Optionally: also export raw audio (if feasible in browser — stretch goal).

---

## Technical Architecture

```
Browser (Web App)
  ├── Microphone Input (Web Audio API)
  ├── Real-time STT (Volcano Engine WebSocket API)
  │     ├── Live transcript display
  │     ├── Wake word detection (string match in transcript)
  │     └── Feed to summary engine
  ├── Summary Engine (Doubao LLM API, triggered every ~5 min)
  ├── Q&A Engine (Doubao LLM API, triggered on wake word)
  ├── TTS Playback (Doubao / Volcano Engine TTS API)
  └── UI (React / single-page app)
```

### API Dependencies

| Capability | Provider | API |
|-----------|----------|-----|
| Real-time STT | Volcano Engine | Streaming ASR (WebSocket) |
| Speaker Diarization | Volcano Engine | Built into ASR if supported, otherwise skip in MVP |
| LLM (summaries + Q&A) | Doubao | Volcano Engine Ark API |
| TTS | Doubao / Volcano Engine | Streaming TTS API |

### Key Technical Decisions

- **Web-first**: No desktop wrapper needed for MVP. Browser provides mic access, audio playback, and sufficient compute for the UI.
- **No local models**: All intelligence runs via cloud APIs. The app is a thin client.
- **No backend server**: Direct browser-to-API calls. API keys stored in browser localStorage (acceptable for MVP since it's a single-user tool on a known machine).
- **No persistent storage**: No database, no IndexedDB, no history. Each meeting session is ephemeral. Export on end.
- **Wake word via transcript matching**: No separate keyword spotting model. The STT stream is already running — just do string matching. Simple, zero additional cost.

---

## Explicitly Out of Scope (MVP)

- ❌ Meeting history / past meeting browsing
- ❌ Cloud sync / user accounts / login
- ❌ Multi-device support
- ❌ Custom knowledge base / RAG / document upload
- ❌ Desktop app wrapper (Tauri/Electron)
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

1. **Desktop app (Tauri)** — For persistent background listening, system-level wake word detection, local file storage, meeting history.
2. **Meeting history** — Left sidebar with past meetings (date, auto-generated topic title), stored locally.
3. **Custom knowledge base** — Upload company docs, product specs, etc. RAG integration so the AI can answer domain-specific questions.
4. **Hardware product** — Dedicated meeting room device (tablet/speaker form factor) with far-field microphone array, always-on, zero-setup.
5. **Team features** — Shared meeting notes, action item tracking, integration with project management tools.
6. **Multi-language** — Real-time translation for cross-language meetings.

---

## Success Criteria (MVP)

The MVP is successful if:

1. A group of 3-5 people can have a 30-minute meeting with the app running.
2. The rolling summaries accurately capture the main discussion topics.
3. A participant can say the wake word, ask a question about what was just discussed, and receive a relevant spoken answer within 5 seconds.
4. The exported meeting minutes are useful enough that someone who missed the meeting can understand what happened.

---

## Open Questions

- [ ] What should the default wake word be? (Needs to be distinctive enough to avoid false triggers in natural conversation, but natural enough to say out loud in a meeting.)
- [ ] Volcano Engine ASR — does the streaming API support speaker diarization out of the box, or does it require a separate post-processing step?
- [ ] TTS latency — is Doubao's streaming TTS fast enough for the "answer within 5 seconds" target, or do we need to consider alternative TTS providers?
- [ ] Browser mic access — any known issues with long-running (60+ min) mic sessions in Chrome/Edge?
- [ ] Context window management — for a 2-hour meeting, how do we keep the LLM context within token limits? Rolling summaries help, but we need to define the exact truncation strategy.
