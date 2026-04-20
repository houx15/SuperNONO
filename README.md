# SuperNono

Offline meeting assistant — Tauri 2 desktop app.

## Status

**M2 shipped** — real Volcano ASR + Doubao E2E Realtime + Doubao LLM, mic
capture via AudioWorklet, credential test buttons, WS reconnect with
backoff, Windows prevent-sleep. See `docs/manual-smoke-m2.md` for the
verification checklist.

Requires: Volcano App ID + Access Key, Doubao API key (entered in
Settings → keychain). macOS or Windows. Node 22.14+ with pnpm 10.29+.

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
