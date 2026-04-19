# SuperNono

Offline meeting assistant — Tauri 2 desktop app.

## Status: M1 (autonomous, fake-drivable)

- Full UI ported from design prototype (Sidebar, Idle, Meeting, Past, Settings, Export)
- Full TS product logic, TDD, no real API calls
- Rust bridges live except the two WebSocket connection paths (stubbed until M2)
- A dev-only fixture replay demo runs a scripted 10-minute meeting end-to-end

## Run

```sh
pnpm install
pnpm tauri dev
```

## Test

```sh
pnpm check       # lint + typecheck + vitest + cargo fmt/clippy/test
```

## Dev tweaks

Press `Ctrl+Alt+D` inside the app to toggle the dev panel.
Use "Replay Q2 strategy" to drive the fixture.

## Spec + design

- Product spec: `docs/SPEC.md`
- Design doc: `docs/superpowers/specs/2026-04-19-supernono-design.md`
- M1 plan: `docs/superpowers/plans/2026-04-19-supernono-m1.md`
