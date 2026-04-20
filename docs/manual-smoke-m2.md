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
