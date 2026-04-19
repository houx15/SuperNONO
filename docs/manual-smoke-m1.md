# SuperNono — M1 Manual Smoke Checklist

Run before cutting M1 as done. Check each item. Stop and investigate any failure.

## Launch

- [ ] `pnpm tauri dev` launches the app with custom macOS window chrome
- [ ] Sidebar shows (empty history on first run, or prior-fixture-run items otherwise)
- [ ] Idle view shows the orb + Start button + keyboard hint

## Window chrome

- [ ] Traffic lights (red/yellow/green) close/minimize/maximize the window
- [ ] Titlebar empty area is draggable

## Keyboard

- [ ] `Cmd+Shift+N` (while idle) opens the meeting view
- [ ] `Ctrl+Alt+D` toggles the dev tweaks panel
- [ ] Theme toggle in the sidebar footer switches light/dark

## Settings

- [ ] Open Settings → enter dummy credentials → Save
- [ ] Reopen Settings → values persisted
- [ ] Volcano Test button returns "× Not implemented until M2"
- [ ] Doubao Test button returns "× Not implemented until M2"

## Fixture demo

- [ ] In DevTweaks, click "Replay Q2 strategy"
- [ ] Meeting view opens, live transcript updates, orb animates
- [ ] After ~8 seconds the wake word triggers, orb turns activated
- [ ] AiBlock appears with the scripted Q&A
- [ ] Orb returns to idle after the turn
- [ ] Click End meeting → Export modal shows agenda + minutes preview
- [ ] Click Download .md → system save dialog appears → file is written to chosen path
- [ ] Meeting appears at top of sidebar history

## Past meetings

- [ ] Click a history item → opens PastMeetingView in read-only mode
- [ ] Summaries + AiBlocks render
- [ ] Re-export from the past view still works

## Verification

- [ ] `pnpm check` passes
- [ ] App survives at least one restart (relaunch → history still shows yesterday's fixture run)
