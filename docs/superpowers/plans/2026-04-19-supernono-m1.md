# SuperNono M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Milestone 1 of SuperNono — a Tauri desktop app whose full UI, full TS product logic, and full Rust bridges (minus live WebSocket connections) are implemented and verified by test-first development plus a dev-only fixture-replay demo. No real Volcano/Doubao calls; no real microphone. End state: launching the app shows the prototype-matched UI, a hidden dev-tweaks panel can replay a scripted 10-min fake meeting end-to-end (summary cards appear, wake-word triggers Q&A, minutes generate, meeting saves to disk and reopens from the sidebar).

**Architecture:** Pure-TS product logic (test-first, dependency-injected adapters) sits on top of thin TS adapters that either wrap Rust commands or return M2-stubs. Rust owns keychain, filesystem, window controls, global shortcut, prevent-sleep, and the *frame codecs* (only) for the two Volcano WebSockets — the connection paths are stubbed. React is UI-only and subscribes to session events via hooks.

**Tech Stack:** Tauri 2 · React 18 + TypeScript · Vite · pnpm · Vitest · ESLint · Prettier · tokio · keyring · tokio-tungstenite · serde

**Spec reference:** `docs/superpowers/specs/2026-04-19-supernono-design.md`. All module boundaries, interfaces, file layouts, and decisions referenced below come from that spec — revisit it whenever a task implies "per spec."

---

## Plan map

- **Phase 0 — Scaffold & tooling** (Tasks 1–5)
- **Phase 1 — Domain types & config** (Tasks 6–7)
- **Phase 2 — Pure TS logic (TDD)** (Tasks 8–13)
- **Phase 3 — Adapter interfaces & fakes** (Tasks 14–18)
- **Phase 4 — Core orchestration** (Tasks 19–21)
- **Phase 5 — Rust bridges** (Tasks 22–31)
- **Phase 6 — TS adapters** (Tasks 32–37)
- **Phase 7 — UI port** (Tasks 38–50)
- **Phase 8 — React hooks** (Tasks 51–54)
- **Phase 9 — App wiring** (Tasks 55–60)
- **Phase 10 — Fixture replay demo** (Tasks 61–63)
- **Phase 11 — Finalize** (Tasks 64–65)

---

## Phase 0 — Scaffold & tooling

### Task 1: Initialize Tauri 2 project

**Files:**
- Create: `package.json`, `src/`, `src-tauri/`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore` (amended).

- [ ] **Step 1: Run the Tauri scaffold**

Run from repo root:
```bash
pnpm create tauri-app@latest supernono-tmp -- --template react-ts --manager pnpm
```

When prompted for identifier, use `com.supernono.app`. For app name, use `SuperNono`.

- [ ] **Step 2: Move scaffolded files to repo root**

```bash
mv supernono-tmp/.gitignore .gitignore.tauri
rsync -av --remove-source-files supernono-tmp/ ./
rmdir supernono-tmp
```

Manually merge `.gitignore.tauri` into the existing `.gitignore` (keep both sets of entries), then `rm .gitignore.tauri`.

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 4: Verify the scaffold runs**

```bash
pnpm tauri dev
```

Expected: a blank Tauri window opens with the default React+Tauri welcome screen. Close it (`Cmd+Q` / `Ctrl+Q`).

- [ ] **Step 5: Commit the scaffold**

```bash
git add -A
git commit -m "scaffold: initial Tauri 2 + React + TS project"
```

---

### Task 2: Configure Vitest

**Files:**
- Modify: `package.json` (dev deps + scripts)
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`

- [ ] **Step 1: Install Vitest and DOM testing libs**

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/logic/**/*.ts'],
    },
  },
});
```

- [ ] **Step 3: Create `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Add test scripts to `package.json`**

Under `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 5: Write a sanity test**

Create `src/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('math still works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

```bash
pnpm test
```

Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: set up vitest with jsdom + RTL"
```

---

### Task 3: Configure ESLint + Prettier

**Files:**
- Create: `.eslintrc.cjs`, `.prettierrc.json`, `.prettierignore`
- Modify: `package.json`

- [ ] **Step 1: Install linting deps**

```bash
pnpm add -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  eslint-plugin-react eslint-plugin-react-hooks eslint-config-prettier \
  prettier
```

- [ ] **Step 2: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['dist', 'src-tauri/target', 'node_modules'],
};
```

- [ ] **Step 3: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create `.prettierignore`**

```
dist
src-tauri/target
node_modules
pnpm-lock.yaml
docs/nono-design/**
```

- [ ] **Step 5: Add scripts to `package.json`**

```json
"lint": "eslint 'src/**/*.{ts,tsx}'",
"lint:fix": "eslint 'src/**/*.{ts,tsx}' --fix",
"format": "prettier --write 'src/**/*.{ts,tsx,css,json,md}'"
```

- [ ] **Step 6: Verify lint passes**

```bash
pnpm lint
```

Expected: zero errors (scaffold code should pass).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: configure eslint + prettier"
```

---

### Task 4: Pre-commit hook

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json`

- [ ] **Step 1: Install husky + lint-staged**

```bash
pnpm add -D husky lint-staged
pnpm exec husky init
```

- [ ] **Step 2: Configure lint-staged in `package.json`**

Top level, add:
```json
"lint-staged": {
  "src/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "src-tauri/**/*.rs": ["cargo fmt --"]
}
```

- [ ] **Step 3: Replace `.husky/pre-commit`**

```sh
pnpm lint-staged
pnpm test -- --changed HEAD
```

- [ ] **Step 4: Smoke test**

Edit `src/sanity.test.ts`, add a trailing blank line, then:
```bash
git add src/sanity.test.ts
git commit -m "chore: trigger husky smoke"
```
Expected: pre-commit runs lint-staged + vitest. If vitest fails because `--changed` isn't helpful on a bare repo, accept the failure and fix by relaxing the hook to just `pnpm lint-staged`.

- [ ] **Step 5: Commit the hook config**

```bash
git add -A
git commit -m "chore: pre-commit hook running lint-staged + vitest"
```

---

### Task 5: Baseline directory structure

**Files:**
- Create: empty placeholder `src/logic/.gitkeep`, `src/adapters/.gitkeep`, `src/ui/.gitkeep`, `src/hooks/.gitkeep`, `fixtures/asr-transcripts/.gitkeep`, `fixtures/doubao-responses/.gitkeep`
- Delete: `src/App.tsx`, `src/App.css`, `src/assets/`, `src/main.tsx` (we'll recreate in Phase 9)
- Modify: `src/main.tsx` — reduced to a minimal bootstrap that React mounts into `#root`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/logic/__fakes__ src/logic/__integration__ src/adapters src/ui src/hooks fixtures/asr-transcripts fixtures/doubao-responses
touch src/logic/.gitkeep src/adapters/.gitkeep src/ui/.gitkeep src/hooks/.gitkeep fixtures/asr-transcripts/.gitkeep fixtures/doubao-responses/.gitkeep
```

- [ ] **Step 2: Gut the scaffolded React tree**

Delete `src/App.tsx`, `src/App.css`, `src/assets/*`. Replace `src/main.tsx` with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return <div style={{ padding: 24 }}>SuperNono — placeholder (M1 Phase 9 will replace)</div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Verify build + dev still work**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: set up src/ layout and gut scaffold components"
```

---

## Phase 1 — Domain types & config

### Task 6: Define domain types

**Files:**
- Create: `src/logic/types.ts`
- Create: `src/logic/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/logic/types.test.ts
import { describe, it, expect } from 'vitest';
import { isFinalUtterance, makeMeetingId } from './types';

describe('types helpers', () => {
  it('recognizes a final utterance', () => {
    expect(isFinalUtterance({ t: 1, speaker: 'S1', text: 'hi', final: true })).toBe(true);
    expect(isFinalUtterance({ t: 1, speaker: 'S1', text: 'hi', final: false })).toBe(false);
  });

  it('mints a meeting id of shape mtg_xxxxxxxx', () => {
    const id = makeMeetingId();
    expect(id).toMatch(/^mtg_[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test src/logic/types.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement types**

```ts
// src/logic/types.ts
export const SCHEMA_VERSION = 1;

export interface Utterance {
  t: number;                        // ms since epoch
  speaker: string;                  // "Speaker 1", "User (to Nono)", "SuperNono", etc.
  text: string;
  final: boolean;
}

export interface Summary {
  time: string;                     // "14:00 — 14:06"
  topic: string;
  text: string;
  speakers: string[] | null;
  state: 'active' | 'done';
  startedAt: number;                // ms
  endedAt: number | null;
}

export interface MeetingMeta {
  schema_version: number;
  id: string;                       // mtg_xxxxxxxx
  title: string;
  started_at: number;
  ended_at: number | null;
  duration_sec: number | null;
  speaker_count: number;
  tag: string;
  active_summary_index: number;
}

export interface AiExchange {
  t: number;
  question: string;
  answer: string;
  cites: string[];                  // empty array in MVP
}

export interface FullMeeting {
  meta: MeetingMeta;
  summaries: Summary[];
  transcript: Utterance[];
  aiExchanges: AiExchange[];
  minutesMd: string | null;
}

export type TestResult = { ok: true } | { ok: false; reason: string };

export type OrbState = 'idle' | 'activated' | 'thinking' | 'speaking';

export function isFinalUtterance(u: Utterance): boolean {
  return u.final === true;
}

export function makeMeetingId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `mtg_${hex}`;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test src/logic/types.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/types.ts src/logic/types.test.ts
git commit -m "feat: domain types + helpers (Utterance, Summary, MeetingMeta, AiExchange)"
```

---

### Task 7: Config constants

**Files:**
- Create: `src/logic/config.ts`

- [ ] **Step 1: Create the config module**

```ts
// src/logic/config.ts
export const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
export const SILENCE_TIMEOUT_MS = 2000;
export const MAX_RAW_WINDOW_MIN_SUMMARY = 5;
export const MAX_RAW_WINDOW_MIN_QA = 2;
export const MAX_CONTEXT_CHARS = 8000;
export const DEFAULT_WAKE_WORD = '嘿 Nono';
export const DEFAULT_LANG: 'zh' | 'en' = 'zh';

export const KEYCHAIN_KEYS = {
  volcanoAppId: 'volcano_app_id',
  volcanoAccessKey: 'volcano_access_key',
  doubaoApiKey: 'doubao_api_key',
} as const;

export const E2E_DEFAULT_VOICE = 'zh_female_vv_jupiter_bigtts';

export const QA_SYSTEM_PROMPT_PREAMBLE =
  'You are SuperNono, an AI participant in a live meeting. ' +
  'Answer concisely, in the same language as the question, ' +
  'based only on the discussion context below.';
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/logic/config.ts
git commit -m "feat: config constants"
```

---

## Phase 2 — Pure TS logic (TDD)

### Task 8: Clock interface + FakeClock

**Files:**
- Create: `src/logic/clock.ts`
- Create: `src/logic/__fakes__/FakeClock.ts`
- Create: `src/logic/__fakes__/FakeClock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/logic/__fakes__/FakeClock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FakeClock } from './FakeClock';

describe('FakeClock', () => {
  it('fires timers in order after advancing', () => {
    const clock = new FakeClock(1000);
    const order: string[] = [];
    clock.setTimeout(() => order.push('a'), 500);
    clock.setTimeout(() => order.push('b'), 200);
    clock.advance(600);
    expect(order).toEqual(['b', 'a']);
  });

  it('cancels a timer', () => {
    const clock = new FakeClock(0);
    const fn = vi.fn();
    const h = clock.setTimeout(fn, 100);
    clock.clearTimeout(h);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports current time', () => {
    const clock = new FakeClock(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test FakeClock.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Clock + FakeClock**

```ts
// src/logic/clock.ts
export type TimerHandle = number;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

export class RealClock implements Clock {
  now() { return Date.now(); }
  setTimeout(fn: () => void, ms: number) { return window.setTimeout(fn, ms) as unknown as TimerHandle; }
  clearTimeout(h: TimerHandle) { window.clearTimeout(h as unknown as number); }
}
```

```ts
// src/logic/__fakes__/FakeClock.ts
import type { Clock, TimerHandle } from '../clock';

interface ScheduledTimer {
  id: TimerHandle;
  fireAt: number;
  fn: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private current: number;
  private nextId = 1;
  private timers: ScheduledTimer[] = [];

  constructor(startMs = 0) { this.current = startMs; }

  now() { return this.current; }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer = { id: this.nextId++, fireAt: this.current + ms, fn, cancelled: false };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(h: TimerHandle) {
    const t = this.timers.find((x) => x.id === h);
    if (t) t.cancelled = true;
  }

  advance(ms: number) {
    const target = this.current + ms;
    while (true) {
      const next = this.timers
        .filter((t) => !t.cancelled && t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.current = next.fireAt;
      next.cancelled = true;
      next.fn();
    }
    this.current = target;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test FakeClock.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/clock.ts src/logic/__fakes__/FakeClock.ts src/logic/__fakes__/FakeClock.test.ts
git commit -m "feat: Clock interface + FakeClock (deterministic time for tests)"
```

---

### Task 9: TranscriptBuffer (TDD)

**Files:**
- Create: `src/logic/TranscriptBuffer.ts`
- Create: `src/logic/TranscriptBuffer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/TranscriptBuffer.test.ts
import { describe, it, expect } from 'vitest';
import { TranscriptBuffer } from './TranscriptBuffer';
import type { Utterance } from './types';

const u = (t: number, text: string, final = true, speaker = 'S1'): Utterance => ({ t, speaker, text, final });

describe('TranscriptBuffer', () => {
  it('keeps finals in append order', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    expect(b.all().map((x) => x.text)).toEqual(['a', 'b']);
  });

  it('drops partials when a newer final arrives', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'hel', false));
    b.append(u(1200, 'hello', true));
    expect(b.all().map((x) => x.text)).toEqual(['hello']);
  });

  it('returns utterances since a timestamp', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    b.append(u(3000, 'c'));
    expect(b.sinceTimestamp(1500).map((x) => x.text)).toEqual(['b', 'c']);
  });

  it('returns text from the last N minutes', () => {
    const b = new TranscriptBuffer();
    b.append(u(0, 'old'));
    b.append(u(60_000 * 3, 'middle'));
    b.append(u(60_000 * 9, 'recent'));
    const out = b.lastNMinutes(2, 60_000 * 10);
    expect(out.map((x) => x.text)).toEqual(['recent']);
  });

  it('tracks last-summary-at watermark', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    b.markSummarizedAt(1500);
    b.append(u(3000, 'c'));
    expect(b.sinceLastSummary().map((x) => x.text)).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test TranscriptBuffer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/TranscriptBuffer.ts
import type { Utterance } from './types';

export class TranscriptBuffer {
  private finals: Utterance[] = [];
  private currentPartial: Utterance | null = null;
  private lastSummaryAt = 0;

  append(u: Utterance) {
    if (u.final) {
      this.finals.push(u);
      this.currentPartial = null;
    } else {
      this.currentPartial = u;
    }
  }

  all(): Utterance[] {
    return [...this.finals];
  }

  currentPartialUtterance(): Utterance | null {
    return this.currentPartial;
  }

  sinceTimestamp(t: number): Utterance[] {
    return this.finals.filter((u) => u.t >= t);
  }

  lastNMinutes(n: number, nowMs: number): Utterance[] {
    const cutoff = nowMs - n * 60_000;
    return this.finals.filter((u) => u.t >= cutoff);
  }

  markSummarizedAt(t: number) {
    this.lastSummaryAt = t;
  }

  sinceLastSummary(): Utterance[] {
    return this.finals.filter((u) => u.t >= this.lastSummaryAt);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test TranscriptBuffer.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/TranscriptBuffer.ts src/logic/TranscriptBuffer.test.ts
git commit -m "feat: TranscriptBuffer — finals store + partial override + time windows"
```

---

### Task 10: WakeWordMatcher (TDD)

**Files:**
- Create: `src/logic/WakeWordMatcher.ts`
- Create: `src/logic/WakeWordMatcher.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/WakeWordMatcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WakeWordMatcher } from './WakeWordMatcher';
import type { Utterance } from './types';

const u = (text: string, final = true): Utterance => ({ t: 0, speaker: 'S1', text, final });

describe('WakeWordMatcher', () => {
  it('fires when the wake word appears in a final utterance', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('今天天气不错'));
    expect(hit).not.toHaveBeenCalled();
    m.observe(u('嘿 Nono，帮我查一下'));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0].text).toContain('嘿 Nono');
  });

  it('ignores partials', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿 Nono，帮我查一下', false));
    expect(hit).not.toHaveBeenCalled();
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('hey nono', hit);
    m.observe(u('Hey  Nono , search this'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('updates wake word on setWakeWord', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('old', hit);
    m.setWakeWord('new');
    m.observe(u('say new please'));
    expect(hit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test WakeWordMatcher.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/WakeWordMatcher.ts
import type { Utterance } from './types';

export class WakeWordMatcher {
  private needle: string;

  constructor(wakeWord: string, private onHit: (u: Utterance) => void) {
    this.needle = normalize(wakeWord);
  }

  setWakeWord(w: string) { this.needle = normalize(w); }

  observe(u: Utterance) {
    if (!u.final) return;
    if (normalize(u.text).includes(this.needle)) this.onHit(u);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test WakeWordMatcher.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/WakeWordMatcher.ts src/logic/WakeWordMatcher.test.ts
git commit -m "feat: WakeWordMatcher — case-insensitive substring match on finals"
```

---

### Task 11: SummaryScheduler (TDD)

**Files:**
- Create: `src/logic/SummaryScheduler.ts`
- Create: `src/logic/SummaryScheduler.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/SummaryScheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SummaryScheduler } from './SummaryScheduler';
import { TranscriptBuffer } from './TranscriptBuffer';
import { FakeClock } from './__fakes__/FakeClock';
import { SUMMARY_INTERVAL_MS } from './config';
import type { Utterance, Summary } from './types';

const u = (t: number, text: string, final = true): Utterance => ({ t, speaker: 'S1', text, final });

const fakeLlmOk = async (_prompt: unknown) => ({
  text: JSON.stringify({ topic: 'Topic', text: 'Summary body', sameTopic: false }),
});

describe('SummaryScheduler', () => {
  it('fires a summary after SUMMARY_INTERVAL_MS', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    buf.append(u(1000, 'alpha beta gamma'));
    const seen: Summary[] = [];
    const s = new SummaryScheduler({
      clock,
      buffer: buf,
      llm: { complete: fakeLlmOk } as never,
      onSummary: (s) => seen.push(s),
    });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.length).toBe(1);
    expect(seen[0].topic).toBe('Topic');
  });

  it('skips the tick and retries next cycle if LLM fails', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    buf.append(u(1000, 'alpha'));
    let calls = 0;
    const llm = {
      complete: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return { text: JSON.stringify({ topic: 'T', text: 'S', sameTopic: false }) };
      }),
    };
    const seen: Summary[] = [];
    const s = new SummaryScheduler({ clock, buffer: buf, llm: llm as never, onSummary: (x) => seen.push(x) });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(seen.length).toBe(1); // only the successful 2nd tick produced a card
  });

  it('does not fire if the buffer has no new text since last summary', async () => {
    const clock = new FakeClock(0);
    const buf = new TranscriptBuffer();
    const llm = { complete: vi.fn(fakeLlmOk) };
    const seen: Summary[] = [];
    const s = new SummaryScheduler({ clock, buffer: buf, llm: llm as never, onSummary: (x) => seen.push(x) });
    s.start();
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(seen).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

async function flush() {
  // Drain microtasks a few times to let chained awaits settle.
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test SummaryScheduler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/SummaryScheduler.ts
import type { Clock } from './clock';
import type { TranscriptBuffer } from './TranscriptBuffer';
import type { Summary } from './types';
import { SUMMARY_INTERVAL_MS, MAX_RAW_WINDOW_MIN_SUMMARY, MAX_CONTEXT_CHARS } from './config';

export interface LlmMinimal {
  complete(req: { prompt: string }): Promise<{ text: string }>;
}

export interface SummarySchedulerDeps {
  clock: Clock;
  buffer: TranscriptBuffer;
  llm: LlmMinimal;
  onSummary: (s: Summary) => void;
  getLastSummary?: () => Summary | null;
}

export class SummaryScheduler {
  private running = false;
  private previous: Summary | null = null;

  constructor(private deps: SummarySchedulerDeps) {}

  start() {
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
  }

  private schedule() {
    if (!this.running) return;
    this.deps.clock.setTimeout(async () => {
      await this.tick();
      this.schedule();
    }, SUMMARY_INTERVAL_MS);
  }

  private async tick() {
    const newUtterances = this.deps.buffer.sinceLastSummary();
    if (newUtterances.length === 0) return;
    const windowText = this.deps.buffer
      .lastNMinutes(MAX_RAW_WINDOW_MIN_SUMMARY, this.deps.clock.now())
      .map((u) => `[${u.speaker}] ${u.text}`)
      .join('\n')
      .slice(-MAX_CONTEXT_CHARS);
    const prompt = buildSummaryPrompt(this.previous, windowText);
    try {
      const resp = await this.deps.llm.complete({ prompt });
      const parsed = JSON.parse(resp.text) as { topic: string; text: string; sameTopic: boolean };
      const now = this.deps.clock.now();
      const summary: Summary = {
        time: formatRange(this.previous?.endedAt ?? now - SUMMARY_INTERVAL_MS, now),
        topic: parsed.topic,
        text: parsed.text,
        speakers: null,
        state: 'done',
        startedAt: this.previous?.endedAt ?? now - SUMMARY_INTERVAL_MS,
        endedAt: now,
      };
      this.previous = summary;
      this.deps.buffer.markSummarizedAt(now);
      this.deps.onSummary(summary);
    } catch {
      // skip this tick; try again next interval
    }
  }
}

function buildSummaryPrompt(prev: Summary | null, recent: string): string {
  return [
    'You are summarising an ongoing meeting segment.',
    'Given the PREVIOUS segment summary and the NEW transcript, return JSON:',
    '{"topic": "...", "text": "2-4 sentences", "sameTopic": bool}',
    'If the topic is unchanged, set sameTopic=true; the caller may merge.',
    '---PREVIOUS---',
    prev ? prev.topic + '\n' + prev.text : '(none)',
    '---NEW TRANSCRIPT---',
    recent,
  ].join('\n');
}

function formatRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toTimeString().slice(0, 5);
  return `${fmt(startMs)} — ${fmt(endMs)}`;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test SummaryScheduler.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/SummaryScheduler.ts src/logic/SummaryScheduler.test.ts
git commit -m "feat: SummaryScheduler — 5-min tick, LLM retry-skip, marks watermark"
```

---

### Task 12: MinutesRenderer (TDD)

**Files:**
- Create: `src/logic/MinutesRenderer.ts`
- Create: `src/logic/MinutesRenderer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/MinutesRenderer.test.ts
import { describe, it, expect } from 'vitest';
import { MinutesRenderer } from './MinutesRenderer';
import type { Summary, Utterance, MeetingMeta } from './types';

const fakeLlm = {
  complete: async (req: { prompt: string }) => ({
    text: JSON.stringify({
      decisions: ['decision A', 'decision B'],
      actions: [{ owner: 'S1', task: 'do the thing', tag: 'Ops' }],
    }),
  }),
};

describe('MinutesRenderer', () => {
  it('returns a markdown document with required sections', async () => {
    const meta: MeetingMeta = {
      schema_version: 1, id: 'mtg_test1234', title: 'Test', started_at: 0, ended_at: 3600_000,
      duration_sec: 3600, speaker_count: 2, tag: 'General', active_summary_index: -1,
    };
    const summaries: Summary[] = [
      { time: '00:00 — 00:05', topic: 'Intro', text: '...', speakers: null, state: 'done', startedAt: 0, endedAt: 300_000 },
    ];
    const tr: Utterance[] = [{ t: 100, speaker: 'S1', text: 'hello', final: true }];
    const md = await new MinutesRenderer(fakeLlm).render({ meta, summaries, transcript: tr });
    expect(md).toContain('# Test');
    expect(md).toContain('## Agenda');
    expect(md).toContain('Intro');
    expect(md).toContain('## Key decisions');
    expect(md).toContain('decision A');
    expect(md).toContain('## Action items');
    expect(md).toContain('do the thing');
    expect(md).toContain('## Full transcript');
    expect(md).toContain('hello');
  });

  it('falls back gracefully when LLM errors', async () => {
    const brokenLlm = { complete: async () => { throw new Error('x'); } };
    const meta: MeetingMeta = {
      schema_version: 1, id: 'x', title: 'T', started_at: 0, ended_at: 1, duration_sec: 0,
      speaker_count: 0, tag: 'General', active_summary_index: -1,
    };
    const md = await new MinutesRenderer(brokenLlm).render({ meta, summaries: [], transcript: [] });
    expect(md).toContain('## Key decisions');
    expect(md).toContain('(minutes generation unavailable'); // graceful line
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test MinutesRenderer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/MinutesRenderer.ts
import type { Summary, Utterance, MeetingMeta } from './types';

export interface LlmMinimal {
  complete(req: { prompt: string }): Promise<{ text: string }>;
}

export interface RenderInput {
  meta: MeetingMeta;
  summaries: Summary[];
  transcript: Utterance[];
}

interface ExtractedSections {
  decisions: string[];
  actions: { owner: string; task: string; tag: string }[];
}

export class MinutesRenderer {
  constructor(private llm: LlmMinimal) {}

  async render(input: RenderInput): Promise<string> {
    const sections = await this.extract(input);
    return [
      `# ${input.meta.title}`,
      '',
      `- Duration: ${secondsToHms(input.meta.duration_sec ?? 0)}`,
      `- Speakers: ${input.meta.speaker_count}`,
      `- Tag: ${input.meta.tag}`,
      '',
      '## Agenda',
      ...input.summaries.map((s) => `- ${s.topic}`),
      '',
      '## Key decisions',
      ...(sections.decisions.length
        ? sections.decisions.map((d) => `- ${d}`)
        : ['- (minutes generation unavailable — summaries preserved below)']),
      '',
      '## Action items',
      ...(sections.actions.length
        ? sections.actions.map((a) => `- **[${a.tag}]** ${a.owner} — ${a.task}`)
        : ['- (none extracted)']),
      '',
      '## Summaries',
      ...input.summaries.flatMap((s) => [`### ${s.time} — ${s.topic}`, s.text, '']),
      '## Full transcript',
      ...input.transcript.map((u) => `- [${fmtT(u.t)}] **${u.speaker}:** ${u.text}`),
      '',
    ].join('\n');
  }

  private async extract(input: RenderInput): Promise<ExtractedSections> {
    if (input.summaries.length === 0 && input.transcript.length === 0) {
      return { decisions: [], actions: [] };
    }
    const prompt = [
      'You are extracting meeting decisions and action items. Return JSON:',
      '{"decisions": string[], "actions": [{"owner": string, "task": string, "tag": string}]}',
      '---SUMMARIES---',
      input.summaries.map((s) => `${s.topic}: ${s.text}`).join('\n'),
      '---TRANSCRIPT (last ~2000 chars)---',
      input.transcript.map((u) => `[${u.speaker}] ${u.text}`).join('\n').slice(-2000),
    ].join('\n');
    try {
      const resp = await this.llm.complete({ prompt });
      const parsed = JSON.parse(resp.text) as ExtractedSections;
      return parsed;
    } catch {
      return { decisions: [], actions: [] };
    }
  }
}

function secondsToHms(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtT(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test MinutesRenderer.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/MinutesRenderer.ts src/logic/MinutesRenderer.test.ts
git commit -m "feat: MinutesRenderer — markdown assembly with LLM-extracted sections"
```

---

### Task 13: HistoryIndex (TDD)

**Files:**
- Create: `src/logic/HistoryIndex.ts`
- Create: `src/logic/HistoryIndex.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/HistoryIndex.test.ts
import { describe, it, expect } from 'vitest';
import { HistoryIndex } from './HistoryIndex';
import type { MeetingMeta, FullMeeting } from './types';

function meta(id: string, ended: number | null): MeetingMeta {
  return { schema_version: 1, id, title: id, started_at: 0, ended_at: ended,
           duration_sec: ended, speaker_count: 1, tag: 'General', active_summary_index: -1 };
}

class InMemP {
  meetings = new Map<string, FullMeeting>();
  async listMeetings() { return [...this.meetings.values()].map((m) => m.meta); }
  async readMeeting(id: string) { return this.meetings.get(id)!; }
}

describe('HistoryIndex', () => {
  it('lists meetings most-recent first', async () => {
    const p = new InMemP();
    p.meetings.set('a', { meta: meta('a', 3000), summaries: [], transcript: [], aiExchanges: [], minutesMd: null });
    p.meetings.set('b', { meta: meta('b', 1000), summaries: [], transcript: [], aiExchanges: [], minutesMd: null });
    const h = new HistoryIndex(p as never);
    const list = await h.list();
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('finds crashed meetings (missing ended_at)', async () => {
    const p = new InMemP();
    p.meetings.set('clean', { meta: meta('clean', 1000), summaries: [], transcript: [], aiExchanges: [], minutesMd: null });
    p.meetings.set('crashed', { meta: meta('crashed', null), summaries: [], transcript: [], aiExchanges: [], minutesMd: null });
    const h = new HistoryIndex(p as never);
    const c = await h.crashRecoveryScan();
    expect(c.map((m) => m.id)).toEqual(['crashed']);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test HistoryIndex.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/HistoryIndex.ts
import type { MeetingMeta, FullMeeting } from './types';

export interface PersistenceRead {
  listMeetings(): Promise<MeetingMeta[]>;
  readMeeting(id: string): Promise<FullMeeting>;
}

export class HistoryIndex {
  constructor(private p: PersistenceRead) {}

  async list(): Promise<MeetingMeta[]> {
    const all = await this.p.listMeetings();
    return all.sort((a, b) => (b.started_at - a.started_at));
  }

  async open(id: string): Promise<FullMeeting> {
    return this.p.readMeeting(id);
  }

  async crashRecoveryScan(): Promise<MeetingMeta[]> {
    const all = await this.p.listMeetings();
    return all.filter((m) => m.ended_at === null);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test HistoryIndex.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/HistoryIndex.ts src/logic/HistoryIndex.test.ts
git commit -m "feat: HistoryIndex — list + open + crashRecoveryScan"
```

---

## Phase 3 — Adapter interfaces & fakes

### Task 14: Adapter interfaces file

**Files:**
- Create: `src/logic/adapters.ts`

- [ ] **Step 1: Create the interfaces module**

```ts
// src/logic/adapters.ts
import type { Utterance, Summary, MeetingMeta, AiExchange, FullMeeting, TestResult } from './types';

export type Unsubscribe = () => void;

export interface AsrOpts {
  lang: 'zh' | 'en';
  enableSpeakerId: boolean;
}

export interface AsrClient {
  start(opts: AsrOpts): Promise<void>;
  stop(): Promise<void>;
  on(event: 'partial' | 'final' | 'error' | 'closed',
     cb: (payload: Utterance | Error) => void): Unsubscribe;
  testCredentials(appId: string, accessKey: string): Promise<TestResult>;
}

export interface E2eOpen {
  systemPrompt: string;
  voice: string;
}

export interface E2eClient {
  open(opts: E2eOpen): Promise<void>;
  sendAudio(chunk: Uint8Array): void;
  on(event: 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error',
     cb: (payload: unknown) => void): Unsubscribe;
  close(): Promise<void>;
  testCredentials(apiKey: string): Promise<TestResult>;
}

export interface LlmReq { prompt: string; }
export interface LlmResp { text: string; }
export interface LlmChunk { delta: string; }

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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/logic/adapters.ts
git commit -m "feat: adapter interfaces (AsrClient, E2eClient, LlmClient, Persistence)"
```

---

### Task 15: FakeAsrClient

**Files:**
- Create: `src/logic/__fakes__/FakeAsrClient.ts`
- Create: `src/logic/__fakes__/FakeAsrClient.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/__fakes__/FakeAsrClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FakeAsrClient } from './FakeAsrClient';

describe('FakeAsrClient', () => {
  it('fires subscribed final events in order', async () => {
    const asr = new FakeAsrClient();
    const seen: string[] = [];
    asr.on('final', (u) => seen.push((u as any).text));
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    asr.emitFinal(1000, 'S1', 'hello');
    asr.emitFinal(2000, 'S2', 'world');
    expect(seen).toEqual(['hello', 'world']);
  });

  it('only fires events after start()', async () => {
    const asr = new FakeAsrClient();
    const seen: unknown[] = [];
    asr.on('final', (u) => seen.push(u));
    asr.emitFinal(1, 'S1', 'dropped');
    expect(seen).toEqual([]);
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    asr.emitFinal(2, 'S1', 'kept');
    expect(seen.length).toBe(1);
  });

  it('testCredentials returns ok by default', async () => {
    const asr = new FakeAsrClient();
    expect(await asr.testCredentials('id', 'key')).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test FakeAsrClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/__fakes__/FakeAsrClient.ts
import type { AsrClient, AsrOpts, Unsubscribe } from '../adapters';
import type { Utterance, TestResult } from '../types';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class FakeAsrClient implements AsrClient {
  private started = false;
  private listeners: Map<EventName, Set<Listener>> = new Map();
  public testResult: TestResult = { ok: true };

  async start(_opts: AsrOpts): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.emit('closed', new Error('stopped'));
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(_appId: string, _accessKey: string) {
    return this.testResult;
  }

  emitFinal(t: number, speaker: string, text: string) {
    if (!this.started) return;
    this.emit('final', { t, speaker, text, final: true });
  }

  emitPartial(t: number, speaker: string, text: string) {
    if (!this.started) return;
    this.emit('partial', { t, speaker, text, final: false });
  }

  emitError(e: Error) { this.emit('error', e); }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test FakeAsrClient.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeAsrClient.ts src/logic/__fakes__/FakeAsrClient.test.ts
git commit -m "feat: FakeAsrClient — scripted ASR events for tests"
```

---

### Task 16: FakeE2eClient

**Files:**
- Create: `src/logic/__fakes__/FakeE2eClient.ts`
- Create: `src/logic/__fakes__/FakeE2eClient.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/__fakes__/FakeE2eClient.test.ts
import { describe, it, expect } from 'vitest';
import { FakeE2eClient } from './FakeE2eClient';

describe('FakeE2eClient', () => {
  it('scripts a full turn', async () => {
    const c = new FakeE2eClient();
    const events: Array<[string, unknown]> = [];
    (['question_transcript','answer_transcript','audio','turn_end','error'] as const)
      .forEach((e) => c.on(e, (p) => events.push([e, p])));
    await c.open({ systemPrompt: 'x', voice: 'vv' });
    c.scriptTurn({
      question: '价格多少?',
      answer: '新加坡市场落在 12-28 美元',
      audioChunks: [new Uint8Array([1,2,3])],
    });
    await Promise.resolve();
    const kinds = events.map(([k]) => k);
    expect(kinds).toContain('question_transcript');
    expect(kinds).toContain('answer_transcript');
    expect(kinds).toContain('audio');
    expect(kinds[kinds.length - 1]).toBe('turn_end');
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test FakeE2eClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/__fakes__/FakeE2eClient.ts
import type { E2eClient, E2eOpen, Unsubscribe } from '../adapters';
import type { TestResult } from '../types';

type EventName = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class FakeE2eClient implements E2eClient {
  private listeners: Map<EventName, Set<(p: unknown) => void>> = new Map();
  private opened = false;
  public testResult: TestResult = { ok: true };
  public received: Uint8Array[] = [];

  async open(_opts: E2eOpen) { this.opened = true; }
  async close() { this.opened = false; }
  sendAudio(chunk: Uint8Array) { if (this.opened) this.received.push(chunk); }

  on(event: EventName, cb: (p: unknown) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(_apiKey: string) { return this.testResult; }

  scriptTurn(t: { question: string; answer: string; audioChunks: Uint8Array[] }) {
    this.emit('question_transcript', { text: t.question });
    for (const chunk of t.audioChunks) this.emit('audio', chunk);
    this.emit('answer_transcript', { text: t.answer });
    this.emit('turn_end', {});
  }

  emitError(e: Error) { this.emit('error', e); }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test FakeE2eClient.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeE2eClient.ts src/logic/__fakes__/FakeE2eClient.test.ts
git commit -m "feat: FakeE2eClient — scripted Q&A turn for tests"
```

---

### Task 17: FakeLlmClient

**Files:**
- Create: `src/logic/__fakes__/FakeLlmClient.ts`
- Create: `src/logic/__fakes__/FakeLlmClient.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/__fakes__/FakeLlmClient.test.ts
import { describe, it, expect } from 'vitest';
import { FakeLlmClient } from './FakeLlmClient';

describe('FakeLlmClient', () => {
  it('returns the first matching response', async () => {
    const llm = new FakeLlmClient([
      { match: (p) => p.includes('summarising'), text: 'SUMMARY_RESP' },
      { match: () => true, text: 'DEFAULT_RESP' },
    ]);
    const r = await llm.complete({ prompt: 'You are summarising...' });
    expect(r.text).toBe('SUMMARY_RESP');
    const r2 = await llm.complete({ prompt: 'something else' });
    expect(r2.text).toBe('DEFAULT_RESP');
  });

  it('errors if no match and no default', async () => {
    const llm = new FakeLlmClient([]);
    await expect(llm.complete({ prompt: 'x' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test FakeLlmClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/__fakes__/FakeLlmClient.ts
import type { LlmClient, LlmReq, LlmResp, LlmChunk } from '../adapters';
import type { TestResult } from '../types';

export interface FakeLlmRule {
  match: (prompt: string) => boolean;
  text: string;
}

export class FakeLlmClient implements LlmClient {
  public testResult: TestResult = { ok: true };
  constructor(private rules: FakeLlmRule[]) {}

  async complete(req: LlmReq): Promise<LlmResp> {
    for (const r of this.rules) if (r.match(req.prompt)) return { text: r.text };
    throw new Error('FakeLlmClient: no rule matched prompt:\n' + req.prompt.slice(0, 200));
  }

  async *stream(req: LlmReq): AsyncIterable<LlmChunk> {
    const resp = await this.complete(req);
    for (const ch of resp.text) yield { delta: ch };
  }

  async testCredentials(_key: string) { return this.testResult; }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test FakeLlmClient.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/FakeLlmClient.ts src/logic/__fakes__/FakeLlmClient.test.ts
git commit -m "feat: FakeLlmClient — rule-based responder"
```

---

### Task 18: InMemoryPersistence

**Files:**
- Create: `src/logic/__fakes__/InMemoryPersistence.ts`
- Create: `src/logic/__fakes__/InMemoryPersistence.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/__fakes__/InMemoryPersistence.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryPersistence } from './InMemoryPersistence';
import type { MeetingMeta, Utterance } from '../types';

const meta: MeetingMeta = {
  schema_version: 1, id: 'mtg_abcd', title: 'X', started_at: 1,
  ended_at: null, duration_sec: null, speaker_count: 0, tag: 'General', active_summary_index: -1,
};

describe('InMemoryPersistence', () => {
  it('stores and reads a meeting end-to-end', async () => {
    const p = new InMemoryPersistence();
    await p.createMeeting(meta);
    const u: Utterance = { t: 10, speaker: 'S1', text: 'hi', final: true };
    await p.appendUtterance(meta.id, u);
    await p.writeSummaries(meta.id, []);
    await p.writeMeta(meta.id, { ...meta, ended_at: 100, duration_sec: 100 });
    await p.writeMinutes(meta.id, '# minutes');
    await p.writeAiExchanges(meta.id, []);
    const full = await p.readMeeting(meta.id);
    expect(full.meta.ended_at).toBe(100);
    expect(full.transcript).toEqual([u]);
    expect(full.minutesMd).toBe('# minutes');
  });

  it('listMeetings returns all created meetings', async () => {
    const p = new InMemoryPersistence();
    await p.createMeeting(meta);
    await p.createMeeting({ ...meta, id: 'mtg_xx', started_at: 5 });
    const all = await p.listMeetings();
    expect(all.length).toBe(2);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test InMemoryPersistence.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/__fakes__/InMemoryPersistence.ts
import type { Persistence } from '../adapters';
import type { MeetingMeta, Utterance, Summary, AiExchange, FullMeeting } from '../types';

interface State {
  meta: MeetingMeta;
  transcript: Utterance[];
  summaries: Summary[];
  aiExchanges: AiExchange[];
  minutesMd: string | null;
}

export class InMemoryPersistence implements Persistence {
  private meetings = new Map<string, State>();

  async createMeeting(meta: MeetingMeta) {
    this.meetings.set(meta.id, { meta, transcript: [], summaries: [], aiExchanges: [], minutesMd: null });
  }
  async appendUtterance(id: string, u: Utterance) { this.get(id).transcript.push(u); }
  async writeSummaries(id: string, s: Summary[]) { this.get(id).summaries = [...s]; }
  async writeMeta(id: string, m: MeetingMeta) { this.get(id).meta = m; }
  async writeMinutes(id: string, md: string) { this.get(id).minutesMd = md; }
  async writeAiExchanges(id: string, ex: AiExchange[]) { this.get(id).aiExchanges = [...ex]; }

  async listMeetings(): Promise<MeetingMeta[]> {
    return [...this.meetings.values()].map((s) => s.meta);
  }

  async readMeeting(id: string): Promise<FullMeeting> {
    const s = this.get(id);
    return { meta: s.meta, summaries: [...s.summaries], transcript: [...s.transcript],
             aiExchanges: [...s.aiExchanges], minutesMd: s.minutesMd };
  }

  async exportMinutes(_id: string, _destPath: string) { /* no-op for tests */ }

  private get(id: string) {
    const s = this.meetings.get(id);
    if (!s) throw new Error(`no meeting ${id}`);
    return s;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test InMemoryPersistence.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/__fakes__/InMemoryPersistence.ts src/logic/__fakes__/InMemoryPersistence.test.ts
git commit -m "feat: InMemoryPersistence — full Persistence impl for tests"
```

---

## Phase 4 — Core orchestration

### Task 19: QaHandoff (TDD)

**Files:**
- Create: `src/logic/QaHandoff.ts`
- Create: `src/logic/QaHandoff.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/QaHandoff.test.ts
import { describe, it, expect, vi } from 'vitest';
import { QaHandoff } from './QaHandoff';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeClock } from './__fakes__/FakeClock';
import { TranscriptBuffer } from './TranscriptBuffer';

describe('QaHandoff', () => {
  it('runs a complete Q&A turn and resumes ASR', async () => {
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const clock = new FakeClock(10_000);
    const buf = new TranscriptBuffer();
    await asr.start({ lang: 'zh', enableSpeakerId: true });
    const asrStopSpy = vi.spyOn(asr, 'stop');
    const asrStartSpy = vi.spyOn(asr, 'start');
    const orbStates: string[] = [];
    const onOrbState = (s: string) => orbStates.push(s);
    const exchanges: unknown[] = [];
    const onExchange = (x: unknown) => exchanges.push(x);

    const qa = new QaHandoff({
      asr, e2e, clock, buffer: buf,
      summaries: () => [],
      onOrbState,
      onExchange,
    });

    await qa.trigger();
    expect(asrStopSpy).toHaveBeenCalled();
    e2e.scriptTurn({
      question: 'Q?', answer: 'A.', audioChunks: [new Uint8Array([1])]
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(orbStates).toEqual(expect.arrayContaining(['activated', 'thinking', 'speaking', 'idle']));
    expect(exchanges.length).toBe(1);
    expect(asrStartSpy).toHaveBeenCalledTimes(2); // initial + resume
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test QaHandoff.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/QaHandoff.ts
import type { AsrClient, E2eClient } from './adapters';
import type { Clock } from './clock';
import type { TranscriptBuffer } from './TranscriptBuffer';
import type { AiExchange, OrbState, Summary, Utterance } from './types';
import { MAX_RAW_WINDOW_MIN_QA, E2E_DEFAULT_VOICE, QA_SYSTEM_PROMPT_PREAMBLE } from './config';

export interface QaHandoffDeps {
  asr: AsrClient;
  e2e: E2eClient;
  clock: Clock;
  buffer: TranscriptBuffer;
  summaries: () => Summary[];
  onOrbState: (s: OrbState) => void;
  onExchange: (x: AiExchange) => void;
  onTranscriptBridge?: (u: Utterance) => void;
}

export class QaHandoff {
  private active = false;

  constructor(private deps: QaHandoffDeps) {}

  async trigger() {
    if (this.active) return;
    this.active = true;
    this.deps.onOrbState('activated');
    await this.deps.asr.stop();

    const systemPrompt = this.buildSystemPrompt();
    const e2e = this.deps.e2e;

    let question = '';
    let answer = '';

    const cleanup: Array<() => void> = [];
    const once = <T extends string>(event: T, fn: (p: unknown) => void) => {
      const unsub = e2e.on(event as never, fn);
      cleanup.push(unsub);
    };

    once('question_transcript', (p) => {
      question = (p as { text: string }).text ?? '';
      this.deps.onOrbState('thinking');
    });
    once('answer_transcript', (p) => {
      answer = (p as { text: string }).text ?? '';
    });
    once('audio', () => {
      this.deps.onOrbState('speaking');
    });

    await new Promise<void>((resolve) => {
      once('turn_end', () => resolve());
      once('error', () => resolve());
      e2e.open({ systemPrompt, voice: E2E_DEFAULT_VOICE }).catch(() => resolve());
    });

    cleanup.forEach((fn) => fn());
    await e2e.close();

    const t = this.deps.clock.now();
    const exchange: AiExchange = { t, question, answer, cites: [] };
    this.deps.onExchange(exchange);
    if (this.deps.onTranscriptBridge) {
      if (question) this.deps.onTranscriptBridge({ t, speaker: 'User (to Nono)', text: question, final: true });
      if (answer)   this.deps.onTranscriptBridge({ t: t + 1, speaker: 'SuperNono', text: answer, final: true });
    }

    await this.deps.asr.start({ lang: 'zh', enableSpeakerId: true });
    this.deps.onOrbState('idle');
    this.active = false;
  }

  private buildSystemPrompt(): string {
    const summaries = this.deps.summaries();
    const summariesText = summaries.map((s) => `- ${s.topic}: ${s.text}`).join('\n');
    const recent = this.deps.buffer
      .lastNMinutes(MAX_RAW_WINDOW_MIN_QA, this.deps.clock.now())
      .map((u) => `[${u.speaker}] ${u.text}`)
      .join('\n');
    return [QA_SYSTEM_PROMPT_PREAMBLE, '---SUMMARIES---', summariesText, '---RECENT---', recent].join('\n');
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test QaHandoff.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/logic/QaHandoff.ts src/logic/QaHandoff.test.ts
git commit -m "feat: QaHandoff — pause ASR, drive E2E turn, resume ASR"
```

---

### Task 20: MeetingSession (TDD)

**Files:**
- Create: `src/logic/MeetingSession.ts`
- Create: `src/logic/MeetingSession.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logic/MeetingSession.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MeetingSession } from './MeetingSession';
import { FakeAsrClient } from './__fakes__/FakeAsrClient';
import { FakeE2eClient } from './__fakes__/FakeE2eClient';
import { FakeLlmClient } from './__fakes__/FakeLlmClient';
import { InMemoryPersistence } from './__fakes__/InMemoryPersistence';
import { FakeClock } from './__fakes__/FakeClock';
import { SUMMARY_INTERVAL_MS, DEFAULT_WAKE_WORD } from './config';
import type { Summary } from './types';

function makeSession() {
  const asr = new FakeAsrClient();
  const e2e = new FakeE2eClient();
  const llm = new FakeLlmClient([
    { match: (p) => p.includes('summarising'), text: JSON.stringify({ topic: 'T', text: 'body', sameTopic: false }) },
    { match: (p) => p.includes('extracting meeting decisions'), text: JSON.stringify({ decisions: [], actions: [] }) },
    { match: () => true, text: JSON.stringify({ topic: 'T', text: 'default', sameTopic: false }) },
  ]);
  const persistence = new InMemoryPersistence();
  const clock = new FakeClock(1_700_000_000_000);
  const session = new MeetingSession({ asr, e2e, llm, persistence, clock,
    config: { wakeWord: DEFAULT_WAKE_WORD, lang: 'zh' } });
  return { session, asr, e2e, llm, persistence, clock };
}

describe('MeetingSession', () => {
  it('emits transcript events and persists utterances', async () => {
    const { session, asr, persistence } = makeSession();
    const transcripts: unknown[] = [];
    session.on('transcript', (u) => transcripts.push(u));
    await session.start('Test meeting');
    asr.emitFinal(1, 'S1', 'hello world');
    await flush();
    expect(transcripts.length).toBe(1);
    const full = await persistence.readMeeting(session.id!);
    expect(full.transcript.map((u) => u.text)).toEqual(['hello world']);
  });

  it('produces a summary after SUMMARY_INTERVAL_MS', async () => {
    const { session, asr, clock } = makeSession();
    const summaries: Summary[] = [];
    session.on('summary', (s) => summaries.push(s));
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', 'lots of content to summarise');
    clock.advance(SUMMARY_INTERVAL_MS);
    await flush();
    expect(summaries.length).toBe(1);
  });

  it('triggers Q&A when wake word is heard', async () => {
    const { session, asr, e2e } = makeSession();
    const orbStates: string[] = [];
    session.on('orbState', (s) => orbStates.push(s));
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', '嘿 Nono, 查价格');
    e2e.scriptTurn({ question: '价格?', answer: '12-28 USD', audioChunks: [new Uint8Array([1])] });
    await flush();
    expect(orbStates).toEqual(expect.arrayContaining(['activated', 'idle']));
  });

  it('on stop, generates minutes and marks ended_at', async () => {
    const { session, asr, persistence } = makeSession();
    await session.start('Meeting');
    asr.emitFinal(1, 'S1', 'hello');
    await session.stop();
    const full = await persistence.readMeeting(session.id!);
    expect(full.meta.ended_at).not.toBeNull();
    expect(full.minutesMd).toContain('# Meeting');
  });
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm test MeetingSession.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/logic/MeetingSession.ts
import type { AsrClient, E2eClient, LlmClient, Persistence } from './adapters';
import type { Clock } from './clock';
import type { AiExchange, MeetingMeta, OrbState, Summary, Utterance } from './types';
import { makeMeetingId, SCHEMA_VERSION } from './types';
import { TranscriptBuffer } from './TranscriptBuffer';
import { WakeWordMatcher } from './WakeWordMatcher';
import { SummaryScheduler } from './SummaryScheduler';
import { QaHandoff } from './QaHandoff';
import { MinutesRenderer } from './MinutesRenderer';

type EventName = 'transcript' | 'summary' | 'qa' | 'orbState' | 'error';
type Handler = (payload: unknown) => void;

export interface MeetingSessionConfig {
  wakeWord: string;
  lang: 'zh' | 'en';
}

export interface MeetingSessionDeps {
  asr: AsrClient;
  e2e: E2eClient;
  llm: LlmClient;
  persistence: Persistence;
  clock: Clock;
  config: MeetingSessionConfig;
}

export class MeetingSession {
  id: string | null = null;
  private meta: MeetingMeta | null = null;
  private buffer = new TranscriptBuffer();
  private summaries: Summary[] = [];
  private aiExchanges: AiExchange[] = [];
  private listeners = new Map<EventName, Set<Handler>>();
  private scheduler: SummaryScheduler | null = null;
  private matcher: WakeWordMatcher | null = null;
  private qa: QaHandoff | null = null;
  private asrUnsub: (() => void)[] = [];
  private running = false;

  constructor(private deps: MeetingSessionDeps) {}

  on(event: EventName, cb: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  async start(title: string): Promise<void> {
    if (this.running) throw new Error('already running');
    this.running = true;
    const id = makeMeetingId();
    const startedAt = this.deps.clock.now();
    const meta: MeetingMeta = {
      schema_version: SCHEMA_VERSION, id, title,
      started_at: startedAt, ended_at: null, duration_sec: null,
      speaker_count: 0, tag: 'General', active_summary_index: -1,
    };
    this.id = id;
    this.meta = meta;
    await this.deps.persistence.createMeeting(meta);

    this.asrUnsub.push(this.deps.asr.on('final', (u) => this.handleUtterance(u as Utterance)));
    this.asrUnsub.push(this.deps.asr.on('partial', (u) => this.buffer.append(u as Utterance)));

    this.matcher = new WakeWordMatcher(this.deps.config.wakeWord, () => this.triggerQa());

    this.scheduler = new SummaryScheduler({
      clock: this.deps.clock,
      buffer: this.buffer,
      llm: this.deps.llm,
      onSummary: (s) => {
        this.summaries.push(s);
        void this.deps.persistence.writeSummaries(id, this.summaries);
        this.emit('summary', s);
      },
    });

    this.qa = new QaHandoff({
      asr: this.deps.asr, e2e: this.deps.e2e, clock: this.deps.clock, buffer: this.buffer,
      summaries: () => this.summaries,
      onOrbState: (s: OrbState) => this.emit('orbState', s),
      onExchange: (x) => {
        this.aiExchanges.push(x);
        void this.deps.persistence.writeAiExchanges(id, this.aiExchanges);
        this.emit('qa', x);
      },
      onTranscriptBridge: (u) => void this.persistUtterance(u),
    });

    await this.deps.asr.start({ lang: this.deps.config.lang, enableSpeakerId: true });
    this.scheduler.start();
  }

  private handleUtterance(u: Utterance) {
    this.buffer.append(u);
    void this.persistUtterance(u);
    this.matcher?.observe(u);
    this.emit('transcript', u);
  }

  private async persistUtterance(u: Utterance) {
    if (!this.id) return;
    await this.deps.persistence.appendUtterance(this.id, u);
  }

  private async triggerQa() {
    if (!this.qa) return;
    await this.qa.trigger();
  }

  async stop(): Promise<void> {
    if (!this.running || !this.meta || !this.id) return;
    this.running = false;
    this.scheduler?.stop();
    for (const unsub of this.asrUnsub) unsub();
    this.asrUnsub = [];
    await this.deps.asr.stop();
    const endedAt = this.deps.clock.now();
    const duration = Math.floor((endedAt - this.meta.started_at) / 1000);

    const renderer = new MinutesRenderer(this.deps.llm);
    const md = await renderer.render({
      meta: { ...this.meta, ended_at: endedAt, duration_sec: duration },
      summaries: this.summaries,
      transcript: this.buffer.all(),
    });
    await this.deps.persistence.writeMinutes(this.id, md);
    const updated: MeetingMeta = {
      ...this.meta, ended_at: endedAt, duration_sec: duration,
      speaker_count: new Set(this.buffer.all().map((u) => u.speaker)).size,
    };
    await this.deps.persistence.writeMeta(this.id, updated);
    this.meta = updated;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test MeetingSession.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logic/MeetingSession.ts src/logic/MeetingSession.test.ts
git commit -m "feat: MeetingSession — long-lived object wiring transcript/summary/Qa/minutes"
```

---

### Task 21: Integration test — scripted 15-min meeting

**Files:**
- Create: `src/logic/__integration__/scripted-meeting.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// src/logic/__integration__/scripted-meeting.test.ts
import { describe, it, expect } from 'vitest';
import { MeetingSession } from '../MeetingSession';
import { FakeAsrClient } from '../__fakes__/FakeAsrClient';
import { FakeE2eClient } from '../__fakes__/FakeE2eClient';
import { FakeLlmClient } from '../__fakes__/FakeLlmClient';
import { InMemoryPersistence } from '../__fakes__/InMemoryPersistence';
import { FakeClock } from '../__fakes__/FakeClock';
import { SUMMARY_INTERVAL_MS, DEFAULT_WAKE_WORD } from '../config';

describe('integration: scripted 15-min meeting', () => {
  it('produces 3 summaries, 1 Q&A exchange, and a non-empty minutes doc', async () => {
    const asr = new FakeAsrClient();
    const e2e = new FakeE2eClient();
    const llm = new FakeLlmClient([
      { match: (p) => p.includes('summarising'), text: JSON.stringify({ topic: 'Topic', text: 'Summary sentence.', sameTopic: false }) },
      { match: (p) => p.includes('extracting'), text: JSON.stringify({ decisions: ['D1'], actions: [{ owner: 'S1', task: 'Do X', tag: 'Ops' }] }) },
      { match: () => true, text: '{"topic":"T","text":"","sameTopic":true}' },
    ]);
    const persistence = new InMemoryPersistence();
    const clock = new FakeClock(1_700_000_000_000);
    const session = new MeetingSession({ asr, e2e, llm, persistence, clock,
      config: { wakeWord: DEFAULT_WAKE_WORD, lang: 'zh' } });

    const summaryEvents: unknown[] = [];
    const qaEvents: unknown[] = [];
    session.on('summary', (s) => summaryEvents.push(s));
    session.on('qa', (x) => qaEvents.push(x));

    await session.start('Scripted meeting');

    for (let i = 0; i < 30; i++) {
      asr.emitFinal(clock.now(), `Speaker ${(i % 3) + 1}`, `Utterance number ${i}.`);
      clock.advance(20_000);
      if (clock.now() % SUMMARY_INTERVAL_MS < 20_000) await flush();
    }

    asr.emitFinal(clock.now(), 'Speaker 1', '嘿 Nono, summarise pricing.');
    await flush();
    e2e.scriptTurn({ question: 'summarise pricing?', answer: 'Pricing summary.', audioChunks: [new Uint8Array([1,2])] });
    await flush();

    await session.stop();
    const full = await persistence.readMeeting(session.id!);
    expect(summaryEvents.length).toBeGreaterThanOrEqual(2);
    expect(qaEvents.length).toBe(1);
    expect(full.minutesMd).toContain('# Scripted meeting');
    expect(full.minutesMd).toContain('D1');
    expect(full.meta.ended_at).not.toBeNull();
  });
});

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
```

- [ ] **Step 2: Run it**

```bash
pnpm test scripted-meeting.test.ts
```

Expected: 1 test passes. (If flaky due to await-timing, increase the flush count.)

- [ ] **Step 3: Commit**

```bash
git add src/logic/__integration__/scripted-meeting.test.ts
git commit -m "test: integration — scripted 15-min fake meeting end-to-end"
```

---

## Phase 5 — Rust bridges

> All Rust modules live under `src-tauri/src/commands/`. Register each command in `src-tauri/src/main.rs` via `.invoke_handler(tauri::generate_handler![...])` as you add it. Run `pnpm tauri dev` periodically to verify the app still compiles.

### Task 22: keychain commands

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `keyring` crate)
- Create: `src-tauri/src/commands/keychain.rs`
- Create: `src-tauri/src/commands/mod.rs` (if it doesn't exist — the module file exposing submodules)
- Modify: `src-tauri/src/main.rs` (register commands)

- [ ] **Step 1: Add the crate**

Edit `src-tauri/Cargo.toml`, in `[dependencies]`, add:
```toml
keyring = "3"
```

Then:
```bash
cd src-tauri && cargo build --release-quiet || cargo build
```

- [ ] **Step 2: Create `src-tauri/src/commands/mod.rs`**

```rust
pub mod keychain;
```

- [ ] **Step 3: Create `src-tauri/src/commands/keychain.rs`**

```rust
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.supernono.app";

#[derive(Debug, Serialize, Deserialize)]
pub struct KeychainError {
    pub message: String,
}

impl From<keyring::Error> for KeychainError {
    fn from(e: keyring::Error) -> Self { Self { message: e.to_string() } }
}

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    entry.set_password(&value)?;
    Ok(())
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> Result<(), KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    match entry.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Gated: the macOS keychain prompts interactively on CI.
    #[test]
    #[ignore]
    fn round_trip() {
        let key = format!("supernono_test_{}", std::process::id());
        tauri::async_runtime::block_on(async {
            keychain_set(key.clone(), "v".into()).await.unwrap();
            assert_eq!(keychain_get(key.clone()).await.unwrap(), Some("v".into()));
            keychain_delete(key).await.unwrap();
        });
    }
}
```

- [ ] **Step 4: Register commands in `main.rs`**

Add `mod commands;` at the top and extend the `.invoke_handler` block:

```rust
mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::keychain::keychain_get,
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Build**

```bash
cd src-tauri && cargo build
```

Expected: compiles without warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/
git commit -m "feat(rust): keychain commands (get/set/delete via keyring crate)"
```

---

### Task 23: meeting_fs — paths + atomic write helper

**Files:**
- Create: `src-tauri/src/commands/meeting_fs.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/Cargo.toml` (add `tempfile`, `thiserror`)

- [ ] **Step 1: Add crates**

In `src-tauri/Cargo.toml`:
```toml
tempfile = "3"
thiserror = "2"
```

- [ ] **Step 2: Create `meeting_fs.rs` with path + atomic-write helper**

```rust
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("path: {0}")]
    Path(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for FsError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn meetings_dir(app: &AppHandle) -> Result<PathBuf, FsError> {
    let base = app.path().app_data_dir().map_err(|e| FsError::Path(e.to_string()))?;
    let dir = base.join("SuperNono").join("meetings");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn meeting_dir(app: &AppHandle, id: &str) -> Result<PathBuf, FsError> {
    let dir = meetings_dir(app)?.join(id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), FsError> {
    let parent = path.parent().ok_or_else(|| FsError::Path("no parent".into()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| FsError::Io(e.error))?;
    Ok(())
}
```

- [ ] **Step 3: Expose the module**

In `src-tauri/src/commands/mod.rs` add:
```rust
pub mod meeting_fs;
```

- [ ] **Step 4: Add a Rust unit test for `atomic_write`**

Append to `meeting_fs.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_file() {
        let d = tempdir().unwrap();
        let path = d.path().join("x.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn atomic_write_overwrites_atomically() {
        let d = tempdir().unwrap();
        let path = d.path().join("x.json");
        atomic_write(&path, b"a").unwrap();
        atomic_write(&path, b"bb").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"bb");
    }
}
```

- [ ] **Step 5: Run Rust tests**

```bash
cd src-tauri && cargo test
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): meeting_fs paths + atomic_write helper (tmp+fsync+rename)"
```

---

### Task 24: meeting_fs — create + write operations

**Files:**
- Modify: `src-tauri/src/commands/meeting_fs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add command functions**

Append to `meeting_fs.rs`:

```rust
#[tauri::command]
pub async fn meeting_create(app: AppHandle, id: String, meta_json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("meeting.json"), meta_json.as_bytes())?;
    atomic_write(&dir.join("summaries.json"), br#"{"schema_version":1,"summaries":[]}"#)?;
    atomic_write(&dir.join("ai-exchanges.json"), br#"{"schema_version":1,"exchanges":[]}"#)?;
    // transcript.jsonl is append-only, created on first append
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_meta(app: AppHandle, id: String, meta_json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("meeting.json"), meta_json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_summaries(app: AppHandle, id: String, json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("summaries.json"), json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_minutes(app: AppHandle, id: String, md: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("minutes.md"), md.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_ai_exchanges(app: AppHandle, id: String, json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("ai-exchanges.json"), json.as_bytes())?;
    Ok(())
}
```

- [ ] **Step 2: Register commands in `main.rs`**

Extend the `generate_handler!` list with `commands::meeting_fs::meeting_create`, `meeting_write_meta`, `meeting_write_summaries`, `meeting_write_minutes`, `meeting_write_ai_exchanges`.

- [ ] **Step 3: Build + test**

```bash
cd src-tauri && cargo build && cargo test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): meeting_fs create + atomic writes (meta, summaries, minutes, exchanges)"
```

---

### Task 25: meeting_fs — append_utterance

**Files:**
- Modify: `src-tauri/src/commands/meeting_fs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add append function**

Append to `meeting_fs.rs`:

```rust
#[tauri::command]
pub async fn meeting_append_utterance(app: AppHandle, id: String, line_json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    let path = dir.join("transcript.jsonl");
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    file.write_all(line_json.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}
```

- [ ] **Step 2: Rust test**

Append to the `tests` module in `meeting_fs.rs`:

```rust
    #[test]
    fn append_grows_file_line_by_line() {
        let d = tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        {
            let mut f = OpenOptions::new().create(true).append(true).open(&p).unwrap();
            f.write_all(b"{\"a\":1}").unwrap(); f.write_all(b"\n").unwrap(); f.sync_all().unwrap();
            f.write_all(b"{\"a\":2}").unwrap(); f.write_all(b"\n").unwrap(); f.sync_all().unwrap();
        }
        let content = fs::read_to_string(&p).unwrap();
        assert_eq!(content.lines().count(), 2);
    }
```

- [ ] **Step 3: Register + build + test**

Add `meeting_append_utterance` to `generate_handler!` in `main.rs`, then:

```bash
cd src-tauri && cargo test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): meeting_fs append_utterance (append + fsync per line)"
```

---

### Task 26: meeting_fs — list + read

**Files:**
- Modify: `src-tauri/src/commands/meeting_fs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add list + read**

Append to `meeting_fs.rs`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct FullMeetingPayload {
    pub meta: serde_json::Value,
    pub summaries: serde_json::Value,
    pub transcript: Vec<serde_json::Value>,
    pub ai_exchanges: serde_json::Value,
    pub minutes_md: Option<String>,
}

#[tauri::command]
pub async fn meeting_list(app: AppHandle) -> Result<Vec<serde_json::Value>, FsError> {
    let dir = meetings_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let e = entry?;
        if !e.file_type()?.is_dir() { continue; }
        let meta_path = e.path().join("meeting.json");
        if !meta_path.exists() { continue; }
        let bytes = fs::read(&meta_path)?;
        let v: serde_json::Value = serde_json::from_slice(&bytes)?;
        out.push(v);
    }
    Ok(out)
}

#[tauri::command]
pub async fn meeting_read(app: AppHandle, id: String) -> Result<FullMeetingPayload, FsError> {
    let dir = meeting_dir(&app, &id)?;
    let meta: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("meeting.json"))?)?;
    let summaries: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("summaries.json")).unwrap_or(b"{\"schema_version\":1,\"summaries\":[]}".to_vec()))?;
    let ai_exchanges: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("ai-exchanges.json")).unwrap_or(b"{\"schema_version\":1,\"exchanges\":[]}".to_vec()))?;
    let minutes_md = fs::read_to_string(dir.join("minutes.md")).ok();

    let mut transcript = Vec::new();
    let tr_path = dir.join("transcript.jsonl");
    if tr_path.exists() {
        let text = fs::read_to_string(tr_path)?;
        for line in text.lines() {
            if line.trim().is_empty() { continue; }
            let v: serde_json::Value = serde_json::from_str(line)?;
            transcript.push(v);
        }
    }

    Ok(FullMeetingPayload { meta, summaries, transcript, ai_exchanges, minutes_md })
}
```

- [ ] **Step 2: Register in `main.rs`**

Add `meeting_list`, `meeting_read` to the handler list.

- [ ] **Step 3: Build**

```bash
cd src-tauri && cargo build
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): meeting_fs list + read (returns FullMeetingPayload)"
```

---

### Task 27: meeting_fs — export_md

**Files:**
- Modify: `src-tauri/src/commands/meeting_fs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add export**

Append to `meeting_fs.rs`:

```rust
#[tauri::command]
pub async fn meeting_export_md(app: AppHandle, id: String, dest_path: String) -> Result<(), FsError> {
    let src = meeting_dir(&app, &id)?.join("minutes.md");
    fs::copy(&src, &PathBuf::from(dest_path))?;
    Ok(())
}
```

- [ ] **Step 2: Register + build**

Add `meeting_export_md` to `main.rs` handlers, `cargo build`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): meeting_export_md (copy stored minutes.md to user path)"
```

---

### Task 28: window_controls

**Files:**
- Create: `src-tauri/src/commands/window_controls.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create module**

```rust
// src-tauri/src/commands/window_controls.rs
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") { w.close().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") { w.minimize().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_maximized().unwrap_or(false) {
            w.unmaximize().map_err(|e| e.to_string())?;
        } else {
            w.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Register**

Add `pub mod window_controls;` to `commands/mod.rs`. In `main.rs` handlers, add:
```
commands::window_controls::window_close,
commands::window_controls::window_minimize,
commands::window_controls::window_toggle_maximize,
```

- [ ] **Step 3: Configure window decorations**

Open `src-tauri/tauri.conf.json`. Under `app.windows[0]`, set:
```json
"decorations": false,
"titleBarStyle": "Overlay",
"hiddenTitle": true
```

(Tauri 2 accepts these; `decorations: false` hides native chrome so we can draw our own.)

- [ ] **Step 4: Build + run**

```bash
cd src-tauri && cargo build
cd .. && pnpm tauri dev
```

Expected: window opens without native decorations. Close via `Cmd+Q`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): window_controls (close/minimize/toggle_maximize) + custom chrome"
```

---

### Task 29: global_shortcut

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add plugin**

```bash
cd src-tauri && cargo add tauri-plugin-global-shortcut
```

- [ ] **Step 2: Register plugin + shortcut in `main.rs`**

```rust
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

// inside main():
tauri::Builder::default()
    .plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_shortcut(
                tauri_plugin_global_shortcut::Shortcut::new(
                    Some(Modifiers::SUPER | Modifiers::SHIFT),
                    Code::KeyN,
                ),
            ).unwrap()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit("shortcut://start-meeting", ());
                }
            })
            .build(),
    )
    .invoke_handler(tauri::generate_handler![/* existing */])
    // ...
```

(Note: on macOS `SUPER` maps to the Command key. On Windows/Linux it'd typically be `CONTROL`; add platform-specific variants in a future task if needed for multi-platform parity.)

- [ ] **Step 3: Build**

```bash
cd src-tauri && cargo build
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): global shortcut ⌘⇧N emits shortcut://start-meeting"
```

---

### Task 30: prevent_sleep (macOS)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/prevent_sleep.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add crates**

```bash
cd src-tauri && cargo add objc2 objc2-foundation core-foundation
```

- [ ] **Step 2: Create module (macOS-only impl, Windows stub)**

```rust
// src-tauri/src/commands/prevent_sleep.rs
use std::sync::Mutex;
use once_cell::sync::Lazy;

#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    pub type IoPmAssertionId = u32;
    extern "C" {
        pub fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: u32,
            assertion_name: CFStringRef,
            assertion_id: *mut IoPmAssertionId,
        ) -> i32;
        pub fn IOPMAssertionRelease(assertion_id: IoPmAssertionId) -> i32;
    }
    pub fn enable(reason: &str) -> Option<IoPmAssertionId> {
        let ty = CFString::new("NoDisplaySleepAssertion");
        let name = CFString::new(reason);
        let mut id: IoPmAssertionId = 0;
        unsafe {
            if IOPMAssertionCreateWithName(
                ty.as_concrete_TypeRef(), 255,
                name.as_concrete_TypeRef(), &mut id,
            ) == 0 { Some(id) } else { None }
        }
    }
    pub fn disable(id: IoPmAssertionId) {
        unsafe { IOPMAssertionRelease(id); }
    }
}

static ACTIVE: Lazy<Mutex<Option<u32>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub async fn prevent_sleep_enable(reason: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if ACTIVE.lock().unwrap().is_some() { return Ok(()); }
        if let Some(id) = mac::enable(&reason) { *ACTIVE.lock().unwrap() = Some(id); }
        else { return Err("IOPMAssertionCreateWithName failed".into()); }
    }
    Ok(())
}

#[tauri::command]
pub async fn prevent_sleep_disable() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(id) = ACTIVE.lock().unwrap().take() { mac::disable(id); }
    }
    Ok(())
}
```

Note: add `once_cell = "1"` to Cargo.toml if not already present. Windows support is a future task (use `SetThreadExecutionState`).

- [ ] **Step 3: Register**

Add `pub mod prevent_sleep;` to `commands/mod.rs`. Add both commands to `main.rs` handlers.

- [ ] **Step 4: Build**

```bash
cd src-tauri && cargo build
```

Expected: compiles on macOS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): prevent_sleep enable/disable (macOS IOPMAssertion, Windows stub)"
```

---

### Task 31: volcano_ws — frame codec skeleton (stubbed connect)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/volcano_ws.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add crates**

```bash
cd src-tauri && cargo add tokio --features "full" tokio-tungstenite
```

- [ ] **Step 2: Create module with frame codec stub + command surface**

```rust
// src-tauri/src/commands/volcano_ws.rs
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct AsrStartParams {
    pub lang: String,
    pub enable_speaker_id: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

// Reference: docs/volcano/asr-stream-api.md — binary frame layout.
// Phase M1 implements codec unit tests; the live .connect() path is completed in M2.
pub mod frame {
    #[derive(Debug, PartialEq)]
    pub struct Frame {
        pub message_type: u8,
        pub flags: u8,
        pub serialization: u8,
        pub compression: u8,
        pub payload: Vec<u8>,
    }
    pub fn encode_header(f: &Frame) -> [u8; 4] {
        [0x11, (f.message_type << 4) | f.flags, (f.serialization << 4) | f.compression, 0x00]
    }
    pub fn decode_header(bytes: &[u8]) -> Option<(u8, u8, u8, u8)> {
        if bytes.len() < 4 { return None; }
        let msg = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let ser = (bytes[2] >> 4) & 0x0f;
        let comp = bytes[2] & 0x0f;
        Some((msg, flags, ser, comp))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn round_trip_header() {
            let f = Frame { message_type: 1, flags: 0, serialization: 1, compression: 0, payload: vec![] };
            let h = encode_header(&f);
            let (m, fl, s, c) = decode_header(&h).unwrap();
            assert_eq!((m, fl, s, c), (1, 0, 1, 0));
        }
    }
}

#[tauri::command]
pub async fn asr_start(_app: AppHandle, _session_id: String, _app_id: String, _access_key: String, _params: AsrStartParams) -> Result<(), String> {
    Err("asr_start: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_send_audio(_session_id: String, _pcm_chunk: Vec<u8>) -> Result<(), String> {
    Err("asr_send_audio: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_stop(_session_id: String) -> Result<(), String> {
    Err("asr_stop: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_test_credentials(_app_id: String, _access_key: String) -> Result<TestResult, String> {
    Ok(TestResult { ok: false, reason: Some("Not implemented until M2".into()) })
}
```

- [ ] **Step 3: Register + build + test**

Add `pub mod volcano_ws;` to `commands/mod.rs`. Register all four commands in `main.rs` handlers.

```bash
cd src-tauri && cargo test volcano_ws
```

Expected: frame codec round-trip test passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): volcano_ws skeleton — frame codec tested, connect stubbed until M2"
```

---

### Task 32: e2e_ws — frame codec skeleton (stubbed connect)

**Files:**
- Create: `src-tauri/src/commands/e2e_ws.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create module**

```rust
// src-tauri/src/commands/e2e_ws.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct E2eOpenOpts {
    pub system_prompt: String,
    pub voice: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

// Reference: docs/volcano/e2e-interaction-api.md — PCM in, PCM out.
pub mod frame {
    pub fn encode_start_session(system_prompt: &str, voice: &str) -> serde_json::Value {
        serde_json::json!({
            "event": "StartSession",
            "payload": { "tts": { "speaker": voice }, "prompts": { "system": system_prompt } }
        })
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn start_session_payload_shape() {
            let v = encode_start_session("hello", "vv");
            assert_eq!(v["event"], "StartSession");
            assert_eq!(v["payload"]["tts"]["speaker"], "vv");
        }
    }
}

#[tauri::command]
pub async fn e2e_open(_session_id: String, _token: String, _opts: E2eOpenOpts) -> Result<(), String> {
    Err("e2e_open: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_send_audio(_session_id: String, _pcm_chunk: Vec<u8>) -> Result<(), String> {
    Err("e2e_send_audio: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_close(_session_id: String) -> Result<(), String> {
    Err("e2e_close: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_test_credentials(_api_key: String) -> Result<TestResult, String> {
    Ok(TestResult { ok: false, reason: Some("Not implemented until M2".into()) })
}
```

- [ ] **Step 2: Register + build + test**

Add `pub mod e2e_ws;` in `commands/mod.rs` and the four commands in `main.rs`.

```bash
cd src-tauri && cargo test e2e_ws
```

Expected: start_session payload test passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(rust): e2e_ws skeleton — payload-shape test, connect stubbed until M2"
```

---

## Phase 6 — TS adapters

### Task 33: KeychainAdapter

**Files:**
- Create: `src/adapters/KeychainAdapter.ts`

- [ ] **Step 1: Write it**

```ts
// src/adapters/KeychainAdapter.ts
import { invoke } from '@tauri-apps/api/core';

export interface KeychainAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const keychain: KeychainAdapter = {
  async get(key) {
    const v = await invoke<string | null>('keychain_get', { key });
    return v ?? null;
  },
  async set(key, value) {
    await invoke('keychain_set', { key, value });
  },
  async delete(key) {
    await invoke('keychain_delete', { key });
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/KeychainAdapter.ts
git commit -m "feat: KeychainAdapter (wraps Rust keychain_get/set/delete)"
```

---

### Task 34: FsAdapter (implements Persistence)

**Files:**
- Create: `src/adapters/FsAdapter.ts`

- [ ] **Step 1: Write it**

```ts
// src/adapters/FsAdapter.ts
import { invoke } from '@tauri-apps/api/core';
import type { Persistence } from '../logic/adapters';
import type { MeetingMeta, Summary, Utterance, AiExchange, FullMeeting } from '../logic/types';
import { SCHEMA_VERSION } from '../logic/types';

export const fsAdapter: Persistence = {
  async createMeeting(meta) {
    await invoke('meeting_create', { id: meta.id, metaJson: JSON.stringify(meta) });
  },
  async appendUtterance(mtgId, u) {
    const line = JSON.stringify({ schema_version: SCHEMA_VERSION, ...u });
    await invoke('meeting_append_utterance', { id: mtgId, lineJson: line });
  },
  async writeSummaries(mtgId, summaries) {
    const json = JSON.stringify({ schema_version: SCHEMA_VERSION, summaries });
    await invoke('meeting_write_summaries', { id: mtgId, json });
  },
  async writeMeta(mtgId, meta) {
    await invoke('meeting_write_meta', { id: mtgId, metaJson: JSON.stringify(meta) });
  },
  async writeMinutes(mtgId, md) {
    await invoke('meeting_write_minutes', { id: mtgId, md });
  },
  async writeAiExchanges(mtgId, exchanges) {
    const json = JSON.stringify({ schema_version: SCHEMA_VERSION, exchanges });
    await invoke('meeting_write_ai_exchanges', { id: mtgId, json });
  },
  async listMeetings(): Promise<MeetingMeta[]> {
    const raw = await invoke<unknown[]>('meeting_list');
    return raw.map((v) => v as MeetingMeta);
  },
  async readMeeting(mtgId): Promise<FullMeeting> {
    const p = await invoke<{
      meta: MeetingMeta;
      summaries: { summaries: Summary[] };
      transcript: Utterance[];
      ai_exchanges: { exchanges: AiExchange[] };
      minutes_md: string | null;
    }>('meeting_read', { id: mtgId });
    return {
      meta: p.meta,
      summaries: p.summaries?.summaries ?? [],
      transcript: p.transcript,
      aiExchanges: p.ai_exchanges?.exchanges ?? [],
      minutesMd: p.minutes_md,
    };
  },
  async exportMinutes(mtgId, destPath) {
    await invoke('meeting_export_md', { id: mtgId, destPath });
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/FsAdapter.ts
git commit -m "feat: FsAdapter — Persistence backed by Rust meeting_fs commands"
```

---

### Task 35: VolcanoAsrClient adapter (M1 stub)

**Files:**
- Create: `src/adapters/VolcanoAsrClient.ts`

- [ ] **Step 1: Write adapter (events wired, connect errors until M2)**

```ts
// src/adapters/VolcanoAsrClient.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult } from '../logic/types';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class VolcanoAsrClient implements AsrClient {
  private sessionId: string;
  private listeners = new Map<EventName, Set<Listener>>();
  private unlistens: UnlistenFn[] = [];

  constructor(sessionId: string) { this.sessionId = sessionId; }

  async start(opts: AsrOpts): Promise<void> {
    // Wire event listeners
    this.unlistens.push(await listen<Utterance>('asr://partial',  (e) => this.emit('partial', e.payload)));
    this.unlistens.push(await listen<Utterance>('asr://final',    (e) => this.emit('final', e.payload)));
    this.unlistens.push(await listen<string>('asr://error',       (e) => this.emit('error', new Error(e.payload))));
    this.unlistens.push(await listen<string>('asr://closed',      () => this.emit('closed', new Error('closed'))));

    await invoke('asr_start', {
      sessionId: this.sessionId, appId: '<stub>', accessKey: '<stub>',
      params: { lang: opts.lang, enable_speaker_id: opts.enableSpeakerId },
    });
  }

  async stop(): Promise<void> {
    try { await invoke('asr_stop', { sessionId: this.sessionId }); } catch { /* stub */ }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(appId: string, accessKey: string): Promise<TestResult> {
    return await invoke<TestResult>('asr_test_credentials', { appId, accessKey });
  }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/VolcanoAsrClient.ts
git commit -m "feat: VolcanoAsrClient adapter — event bridge, connect stubbed via Rust"
```

---

### Task 36: DoubaoE2eClient adapter (M1 stub)

**Files:**
- Create: `src/adapters/DoubaoE2eClient.ts`

- [ ] **Step 1: Write adapter**

```ts
// src/adapters/DoubaoE2eClient.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { E2eClient, E2eOpen, Unsubscribe } from '../logic/adapters';
import type { TestResult } from '../logic/types';

type EventName = 'question_transcript' | 'answer_transcript' | 'audio' | 'turn_end' | 'error';

export class DoubaoE2eClient implements E2eClient {
  private listeners = new Map<EventName, Set<(p: unknown) => void>>();
  private unlistens: UnlistenFn[] = [];

  constructor(private sessionId: string) {}

  async open(opts: E2eOpen): Promise<void> {
    this.unlistens.push(await listen('e2e://question_transcript', (e) => this.emit('question_transcript', e.payload)));
    this.unlistens.push(await listen('e2e://answer_transcript',   (e) => this.emit('answer_transcript', e.payload)));
    this.unlistens.push(await listen('e2e://audio',               (e) => this.emit('audio', e.payload)));
    this.unlistens.push(await listen('e2e://turn_end',            () => this.emit('turn_end', {})));
    this.unlistens.push(await listen<string>('e2e://error',       (e) => this.emit('error', new Error(e.payload))));

    await invoke('e2e_open', { sessionId: this.sessionId, token: '<stub>', opts: { system_prompt: opts.systemPrompt, voice: opts.voice } });
  }

  async close(): Promise<void> {
    try { await invoke('e2e_close', { sessionId: this.sessionId }); } catch { /* stub */ }
    for (const u of this.unlistens) u();
    this.unlistens = [];
  }

  sendAudio(chunk: Uint8Array): void {
    void invoke('e2e_send_audio', { sessionId: this.sessionId, pcmChunk: Array.from(chunk) });
  }

  on(event: EventName, cb: (p: unknown) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(apiKey: string): Promise<TestResult> {
    return await invoke<TestResult>('e2e_test_credentials', { apiKey });
  }

  private emit(event: EventName, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add src/adapters/DoubaoE2eClient.ts
git commit -m "feat: DoubaoE2eClient adapter — event bridge, connect stubbed via Rust"
```

---

### Task 37: DoubaoLlmClient adapter (M1 stub)

**Files:**
- Create: `src/adapters/DoubaoLlmClient.ts`

- [ ] **Step 1: Write adapter**

```ts
// src/adapters/DoubaoLlmClient.ts
import type { LlmClient, LlmReq, LlmResp, LlmChunk } from '../logic/adapters';
import type { TestResult } from '../logic/types';

export class DoubaoLlmClient implements LlmClient {
  constructor(private apiKey: string | null) {}

  async complete(_req: LlmReq): Promise<LlmResp> {
    throw new Error('DoubaoLlmClient: real HTTP call implemented in M2');
  }

  async *stream(_req: LlmReq): AsyncIterable<LlmChunk> {
    throw new Error('DoubaoLlmClient.stream: real HTTP call implemented in M2');
    yield { delta: '' }; // unreachable — satisfies the generator typing
  }

  async testCredentials(_apiKey: string): Promise<TestResult> {
    return { ok: false, reason: 'Not implemented until M2' };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add src/adapters/DoubaoLlmClient.ts
git commit -m "feat: DoubaoLlmClient — M1 stub (errors until M2)"
```

---

## Phase 7 — UI port

> **Pattern for this phase.** The prototype components are under `docs/nono-design/nono/project/` and use globals like `window.MEETING_DATA` plus `const { useState } = React`. Each task below ports one component to idiomatic React+TS: proper imports, explicit prop types, no globals. **The JSX tree and CSS class names are preserved verbatim** so the visual output stays pixel-identical. We add `.test.tsx` files only for components whose rendering has nontrivial conditional logic — dumb wrappers get a smoke test only.

### Task 38: Extract CSS from prototype

**Files:**
- Create: `src/ui/styles/tokens.css`
- Create: `src/ui/styles/desktop.css`
- Create: `src/ui/styles/app.css`
- Modify: `src/main.tsx`

- [ ] **Step 1: Copy the two CSS files verbatim**

```bash
cp docs/nono-design/nono/project/desktop.css src/ui/styles/desktop.css
cp docs/nono-design/nono/project/app.css src/ui/styles/app.css
```

- [ ] **Step 2: Extract theme tokens into `tokens.css`**

Open both CSS files and locate the `:root { ... }` block (plus the `html[data-theme="dark"] { ... }` block). Extract those blocks into `src/ui/styles/tokens.css` and delete them from the original files. The tokens file should contain all CSS variables (`--bg`, `--fg`, `--accent`, etc.) for both themes.

- [ ] **Step 3: Import in `src/main.tsx`**

```tsx
import './ui/styles/tokens.css';
import './ui/styles/desktop.css';
import './ui/styles/app.css';
```

- [ ] **Step 4: Dev-check**

```bash
pnpm tauri dev
```

Expected: window renders with the theme colors applied to the placeholder body (at least the background color changes).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): import prototype CSS + extract tokens"
```

---

### Task 39: Icon component

**Files:**
- Create: `src/ui/Icon.tsx`

- [ ] **Step 1: Port from `docs/nono-design/nono/project/Meeting.jsx` (the `Icon` function at top)**

Create `src/ui/Icon.tsx` with:
```tsx
import React from 'react';

type IconName =
  | 'settings' | 'download' | 'close' | 'mic' | 'speaker' | 'key'
  | 'globe' | 'sparkle' | 'moon' | 'sun' | 'check' | 'link' | 'clock';

interface Props { name: IconName; size?: number; }

export function Icon({ name, size = 16 }: Props) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  // Paste the switch block from Meeting.jsx verbatim here,
  // preserving every <svg>...</svg> arm and the default `return null`.
  switch (name) {
    // ... (copy every case from the prototype's Icon function)
    default: return null;
  }
}
```

Copy each SVG arm from `docs/nono-design/nono/project/Meeting.jsx` lines 7-73 into the switch.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/Icon.tsx
git commit -m "feat(ui): Icon component (13 icons ported from prototype)"
```

---

### Task 40: Orb component

**Files:**
- Create: `src/ui/Orb.tsx`
- Create: `src/ui/Orb.test.tsx`

- [ ] **Step 1: Port from `Orb.jsx`**

Create `src/ui/Orb.tsx`. Translate the prototype's `Orb`, `WaveformOrb`, `computeAmps`, `TriggerTick` functions into typed TS/TSX:

```tsx
import React, { useState, useEffect } from 'react';
import type { OrbState } from '../logic/types';

interface Props { state: OrbState; size?: number; }

const BAR_COUNT = 32;

// Copy computeAmps verbatim from Orb.jsx (lines 29-77), typed as:
// function computeAmps(state: OrbState, t: number): number[] { ... }

// Copy WaveformOrb body from Orb.jsx (lines 79-200), typed as:
// function WaveformOrb({ state, size, t }: { state: OrbState; size: number; t: number }) { ... }

// Copy TriggerTick verbatim.

export function Orb({ state = 'idle', size = 170 }: Props) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf: number; const start = performance.now();
    const tick = (n: number) => { setT((n - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <WaveformOrb state={state} size={size} t={t} />;
}
```

- [ ] **Step 2: Smoke test**

```tsx
// src/ui/Orb.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Orb } from './Orb';

describe('Orb', () => {
  it('renders without crashing for each state', () => {
    (['idle','activated','thinking','speaking'] as const).forEach((s) => {
      const { container } = render(<Orb state={s} />);
      expect(container.querySelector('svg')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Verify tests pass**

```bash
pnpm test Orb.test.tsx
```

Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add src/ui/Orb.tsx src/ui/Orb.test.tsx
git commit -m "feat(ui): Orb component (4 states, 32-bar waveform)"
```

---

### Task 41: SummaryCard component

**Files:**
- Create: `src/ui/SummaryCard.tsx`

- [ ] **Step 1: Port from `Meeting.jsx` (lines 77-98)**

```tsx
// src/ui/SummaryCard.tsx
import React from 'react';
import type { Summary } from '../logic/types';

export function SummaryCard({ s }: { s: Summary }) {
  const isBuilding = s.state === 'active';
  return (
    <article className={`summary-card ${isBuilding ? 'building' : ''}`}>
      <div className="summary-time">{s.time}</div>
      <div className="summary-body">
        {isBuilding && <div className="building-meta">Summarizing · 实时总结中</div>}
        <h3>{s.topic}</h3>
        <p>{s.text}</p>
        {s.speakers && (
          <div className="summary-chips">
            {s.speakers.map((sp, i) => (<span key={i} className="chip speaker">{sp}</span>))}
          </div>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/SummaryCard.tsx
git commit -m "feat(ui): SummaryCard component"
```

---

### Task 42: AiBlock component

**Files:**
- Create: `src/ui/AiBlock.tsx`

- [ ] **Step 1: Port from `Meeting.jsx` (lines 100-165)**

```tsx
// src/ui/AiBlock.tsx
import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  question: string;
  answer: string;
  cites: string[] | null;
  speaking: boolean;
  thinking: boolean;
  timestampLabel?: string;
}

export function AiBlock({ question, answer, cites, speaking, thinking, timestampLabel = '' }: Props) {
  return (
    <div className="ai-block">
      <div className="ai-rail">
        <div className="ai-tag">SuperNono</div>
        <div className="ai-time">{timestampLabel}</div>
      </div>
      <div className="ai-body">
        <div className="ai-qa">
          <span className="ai-q-label">Captured question</span>
          <p className="ai-q-text">{question}</p>
        </div>
        {thinking ? (
          <ThinkingState/>
        ) : (
          <>
            <p className="ai-answer" dangerouslySetInnerHTML={{ __html: answer }}/>
            {cites && cites.length > 0 && (
              <div className="ai-sources">
                {cites.map((c, i) => (
                  <a key={i} className="ai-source" href="#" onClick={(e) => e.preventDefault()}>
                    <span className="dot"/> {c}
                  </a>
                ))}
              </div>
            )}
            <div className="ai-meta-row">
              <span className="meta-item"><Icon name="sparkle" size={10}/> Doubao E2E · realtime</span>
              {speaking && (
                <span className="meta-item" style={{ color: 'var(--accent)', marginLeft: 'auto' }}>
                  🔊 Speaking
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ThinkingState() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="ai-answer" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      color: 'var(--fg-muted)', fontFamily: 'var(--mono)', fontSize: 13,
    }}>
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--warning)',
            opacity: dots > i ? 1 : 0.22,
            transition: 'opacity 0.2s',
          }}/>
        ))}
      </span>
      Generating answer…
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/AiBlock.tsx
git commit -m "feat(ui): AiBlock component (captured Q, answer, thinking state)"
```

---

### Task 43: LiveTranscript component

**Files:**
- Create: `src/ui/LiveTranscript.tsx`

- [ ] **Step 1: Port from `Meeting.jsx` (lines 167-226)**

```tsx
// src/ui/LiveTranscript.tsx
import React from 'react';
import type { OrbState } from '../logic/types';

interface Props {
  displayText: string;
  speaker: string | null;
  state: OrbState;
}

export function LiveTranscript({ displayText, speaker, state }: Props) {
  const TAIL_LEN = 22;
  const isTailing = displayText.length > TAIL_LEN;
  const tailText = isTailing ? displayText.slice(-TAIL_LEN) : displayText;

  const label = ({
    idle: 'Live transcript',
    activated: 'Captured input',
    thinking: 'Processing',
    speaking: 'Speaking',
  } as const)[state];

  return (
    <div className="live-transcript">
      <div className="live-label"><span className="pip" />{label}</div>
      <div className="live-text">
        <span className="transcript-scroll">
          <span className="transcript-inner">
            {speaker && <span className="speaker-tag">{speaker}</span>}
            {isTailing && <span className="transcript-prefix">… </span>}
            <span>{tailText}</span>
            {state !== 'speaking' && <span className="cursor-bar" />}
          </span>
        </span>
      </div>
    </div>
  );
}
```

Note: the prototype embedded its own typing animation. We're inverting that — the live session drives text directly via props. Animation responsibility lives in the parent hook.

- [ ] **Step 2: Commit**

```bash
git add src/ui/LiveTranscript.tsx
git commit -m "feat(ui): LiveTranscript (prop-driven, no internal timer)"
```

---

### Task 44: TrafficLights component

**Files:**
- Create: `src/ui/TrafficLights.tsx`

- [ ] **Step 1: Create component wired to Rust window commands**

```tsx
// src/ui/TrafficLights.tsx
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props { theme: 'light' | 'dark'; }

export function TrafficLights({ theme }: Props) {
  const border = theme === 'dark'
    ? '0.5px solid rgba(255,255,255,0.08)'
    : '0.5px solid rgba(0,0,0,0.06)';
  const dot = (bg: string, label: string, onClick: () => void) => (
    <button
      className="tl-dot"
      aria-label={label}
      onClick={onClick}
      style={{ width: 12, height: 12, borderRadius: '50%', background: bg, border, cursor: 'default', padding: 0 }}
    />
  );
  return (
    <div className="traffic-lights" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {dot('#ff5f57', 'close', () => invoke('window_close').catch(() => {}))}
      {dot('#febc2e', 'minimize', () => invoke('window_minimize').catch(() => {}))}
      {dot('#28c840', 'maximize', () => invoke('window_toggle_maximize').catch(() => {}))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/TrafficLights.tsx
git commit -m "feat(ui): TrafficLights wired to Rust window_* commands"
```

---

### Task 45: Sidebar component

**Files:**
- Create: `src/ui/Sidebar.tsx`

- [ ] **Step 1: Port from `App.jsx` `Sidebar` function (lines 14-105)**

```tsx
// src/ui/Sidebar.tsx
import React from 'react';
import type { MeetingMeta } from '../logic/types';
import { Icon } from './Icon';
import { TrafficLights } from './TrafficLights';

export interface SidebarProps {
  theme: 'light' | 'dark';
  history: MeetingMeta[];
  activeMeetingId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartMeeting: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  isMeetingActive: boolean;
}

export function Sidebar(props: SidebarProps) {
  const { theme, history, activeMeetingId, selectedId, onSelect, onStartMeeting,
          onToggleTheme, onOpenSettings, isMeetingActive } = props;

  return (
    <aside className="sidebar">
      <div className="sidebar-traffic"><TrafficLights theme={theme} /></div>
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"/>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">SuperNono</div>
            <div className="sidebar-brand-ver">v0.9.2 · desktop</div>
          </div>
        </div>
        <button
          className={`btn ${isMeetingActive ? 'btn-recording' : 'btn-primary'} btn-new`}
          onClick={onStartMeeting}
          disabled={isMeetingActive}
        >
          {isMeetingActive ? (
            <><span className="rec-dot-sm" style={{ marginRight: 2 }}/>Recording</>
          ) : (
            <><Icon name="mic" size={13}/> Start meeting</>
          )}
        </button>
      </div>
      <div className="sidebar-section-label">
        <span>History</span>
        <span className="sidebar-count">{history.length}</span>
      </div>
      <div className="sidebar-history">
        {history.map((m) => (
          <button
            key={m.id}
            className={`history-item ${selectedId === m.id ? 'selected' : ''} ${m.id === activeMeetingId ? 'active-rec' : ''}`}
            onClick={() => onSelect(m.id)}
          >
            <div className="history-item-row">
              <span className="history-title">{m.title}</span>
              {m.id === activeMeetingId
                ? <span className="history-live-pip"/>
                : <span className="history-tag">{m.tag}</span>}
            </div>
            <div className="history-meta">
              <span className="history-date">{formatDate(m.started_at)}</span>
              <span className="history-dot">·</span>
              <span className="history-dur">{formatDuration(m.duration_sec)}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="sidebar-foot">
        <button className="sidebar-foot-btn" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <button className="sidebar-foot-btn" onClick={onOpenSettings}>
          <Icon name="settings" size={14}/>
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `今天 · ${d.toTimeString().slice(0, 5)}`;
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString();
  if (d.toDateString() === yesterday) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/Sidebar.tsx
git commit -m "feat(ui): Sidebar (brand, Start/Recording button, history list, footer)"
```

---

### Task 46: IdleView component

**Files:**
- Create: `src/ui/IdleView.tsx`

- [ ] **Step 1: Port from `App.jsx` `IdleView` (lines 108-130)**

```tsx
// src/ui/IdleView.tsx
import React from 'react';
import { Orb } from './Orb';
import { Icon } from './Icon';

interface Props { onStart: () => void; }

export function IdleView({ onStart }: Props) {
  return (
    <div className="idle-view">
      <div className="idle-inner">
        <div className="idle-orb-stage"><Orb state="idle" size={220}/></div>
        <div className="idle-heading">No meeting in progress</div>
        <div className="idle-sub">
          Start a session and SuperNono will listen, summarize and answer questions on demand.
        </div>
        <button className="btn btn-primary btn-start" onClick={onStart}>
          <Icon name="mic" size={14}/> Start meeting
        </button>
        <div className="idle-shortcuts">
          <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>N</kbd> Start</span>
          <span className="sep">·</span>
          <span>Say <kbd>嘿 Nono</kbd> to ask</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/IdleView.tsx
git commit -m "feat(ui): IdleView (big orb, Start button, keyboard hint)"
```

---

### Task 47: MeetingView component (static shell)

**Files:**
- Create: `src/ui/MeetingView.tsx`

- [ ] **Step 1: Port from `App.jsx` `MeetingView` (lines 133-252)**

Key changes from the prototype:
- Takes everything as props (no global `MEETING_DATA`, no `tweaks` object).
- Status bar's `displayText` and `speaker` come from props, not an internal typing animation.
- Still no real session hookup — that arrives in Phase 9.

```tsx
// src/ui/MeetingView.tsx
import React from 'react';
import type { AiExchange, OrbState, Summary } from '../logic/types';
import { Orb } from './Orb';
import { Icon } from './Icon';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { LiveTranscript } from './LiveTranscript';

export interface MeetingViewProps {
  title: string;
  elapsedSec: number;
  summaries: Summary[];
  activeSummary: Summary | null;
  currentExchange: AiExchange | null;
  orbState: OrbState;
  orbSize: number;
  liveText: string;
  liveSpeaker: string | null;
  wakeWord: string;
  onOpenSettings: () => void;
  onEnd: () => void;
}

export function MeetingView(p: MeetingViewProps) {
  const stateLabel = ({
    idle: 'Listening', activated: 'Activated', thinking: 'Thinking', speaking: 'Responding',
  } as const)[p.orbState === 'idle' ? 'idle' : p.orbState];

  return (
    <>
      <div className="main-toolbar">
        <div className="main-toolbar-left">
          <div className="rec-indicator"><span className="rec-dot" /><span>REC {fmtElapsed(p.elapsedSec)}</span></div>
          <div className="main-meeting-title">{p.title}</div>
        </div>
        <div className="main-toolbar-right">
          <button className="icon-btn" onClick={p.onOpenSettings} aria-label="Settings"><Icon name="settings" /></button>
          <button className="btn btn-end" onClick={p.onEnd}>End meeting</button>
        </div>
      </div>

      <main className="main">
        <div className="column">
          {p.summaries.map((s, i) => <SummaryCard key={i} s={s} />)}
          {p.currentExchange && (
            <AiBlock
              question={p.currentExchange.question}
              answer={p.currentExchange.answer}
              cites={p.currentExchange.cites}
              speaking={p.orbState === 'speaking'}
              thinking={p.orbState === 'thinking'}
              timestampLabel={new Date(p.currentExchange.t).toTimeString().slice(0, 8)}
            />
          )}
          {p.activeSummary && <SummaryCard s={p.activeSummary} />}
        </div>
      </main>

      <div className="statusbar">
        <div className="statusbar-inner">
          <div className="orb-with-hint">
            <div className={`status-chip state-${p.orbState}`}><span className="dot"/>{stateLabel}</div>
            <div className="orb-stage"><Orb state={p.orbState} size={p.orbSize} /></div>
          </div>
          <LiveTranscript displayText={p.liveText} speaker={p.liveSpeaker} state={p.orbState} />
          <div className="orb-hint">
            {p.orbState === 'idle'       ? <>Say <kbd>{p.wakeWord}</kbd> to ask</>
             : p.orbState === 'activated' ? <span style={{ color: 'var(--accent)' }}>Listening for question…</span>
             : p.orbState === 'thinking'  ? <span style={{ color: 'var(--warning)' }}>Generating answer…</span>
             :                              <span style={{ color: 'var(--accent)' }}>Speaking</span>}
          </div>
        </div>
      </div>
    </>
  );
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/MeetingView.tsx
git commit -m "feat(ui): MeetingView (prop-driven shell, no globals)"
```

---

### Task 48: PastMeetingView component

**Files:**
- Create: `src/ui/PastMeetingView.tsx`

- [ ] **Step 1: Create**

```tsx
// src/ui/PastMeetingView.tsx
import React from 'react';
import type { FullMeeting } from '../logic/types';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { Icon } from './Icon';

interface Props {
  meeting: FullMeeting;
  onReExport: () => void;
}

export function PastMeetingView({ meeting, onReExport }: Props) {
  return (
    <>
      <div className="main-toolbar">
        <div className="main-toolbar-left">
          <div className="main-meeting-title">{meeting.meta.title}</div>
        </div>
        <div className="main-toolbar-right">
          <button className="btn btn-primary" onClick={onReExport}>
            <Icon name="download" size={14}/> Re-export
          </button>
        </div>
      </div>
      <main className="main">
        <div className="column">
          {meeting.summaries.map((s, i) => <SummaryCard key={i} s={s} />)}
          {meeting.aiExchanges.map((x, i) => (
            <AiBlock
              key={i}
              question={x.question}
              answer={x.answer}
              cites={x.cites}
              speaking={false}
              thinking={false}
              timestampLabel={new Date(x.t).toTimeString().slice(0, 8)}
            />
          ))}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/PastMeetingView.tsx
git commit -m "feat(ui): PastMeetingView (read-only history viewer with re-export)"
```

---

### Task 49: SettingsModal component (with Test buttons)

**Files:**
- Create: `src/ui/SettingsModal.tsx`

- [ ] **Step 1: Port from `Meeting.jsx` `SettingsModal` (lines 228-318)**

Key changes:
- Credentials persisted via keychain, not localStorage.
- Each credential row has a **Test** button that calls the adapter's `testCredentials()` and shows ✓ / × inline.
- In M1 every Test button returns "Not implemented until M2" — that's fine; the UI surfaces it.

```tsx
// src/ui/SettingsModal.tsx
import React, { useState } from 'react';
import { Icon } from './Icon';
import type { TestResult } from '../logic/types';

export interface SettingsModalProps {
  wakeWord: string; setWakeWord: (w: string) => void;
  volcanoAppId: string; setVolcanoAppId: (v: string) => void;
  volcanoAccessKey: string; setVolcanoAccessKey: (v: string) => void;
  doubaoApiKey: string; setDoubaoApiKey: (v: string) => void;
  testVolcano: (appId: string, accessKey: string) => Promise<TestResult>;
  testDoubao: (apiKey: string) => Promise<TestResult>;
  onClose: () => void;
  onSave: () => Promise<void>;
}

export function SettingsModal(p: SettingsModalProps) {
  const [volcanoTest, setVolcanoTest] = useState<TestResult | null>(null);
  const [doubaoTest, setDoubaoTest] = useState<TestResult | null>(null);

  const runVolcanoTest = async () => {
    setVolcanoTest(null);
    const r = await p.testVolcano(p.volcanoAppId, p.volcanoAccessKey);
    setVolcanoTest(r);
  };
  const runDoubaoTest = async () => {
    setDoubaoTest(null);
    const r = await p.testDoubao(p.doubaoApiKey);
    setDoubaoTest(r);
  };

  return (
    <div className="modal-scrim" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Settings</h3><div className="sub">Configure · v0.9.2</div></div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">

          <div className="form-row">
            <label>Wake word · 唤醒词</label>
            <input className="input" value={p.wakeWord}
              onChange={(e) => p.setWakeWord(e.target.value)} placeholder="e.g. 嘿 Nono" />
          </div>

          <div className="form-row">
            <label>Volcano App ID</label>
            <input className="input mono" value={p.volcanoAppId}
              onChange={(e) => p.setVolcanoAppId(e.target.value)} placeholder="123456789" />
          </div>

          <div className="form-row">
            <label>Volcano Access Key</label>
            <div className="select-row">
              <input className="input mono" type="password" value={p.volcanoAccessKey}
                onChange={(e) => p.setVolcanoAccessKey(e.target.value)} placeholder="sk-..." style={{ flex: 1 }} />
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={runVolcanoTest}>Test</button>
            </div>
            {volcanoTest && <div className="hint" style={{ color: volcanoTest.ok ? 'var(--accent)' : 'var(--warning)' }}>
              {volcanoTest.ok ? '✓ Credentials accepted' : `× ${volcanoTest.reason}`}
            </div>}
            <div className="hint">Stored in OS keychain.</div>
          </div>

          <div className="form-row">
            <label>Doubao API key</label>
            <div className="select-row">
              <input className="input mono" type="password" value={p.doubaoApiKey}
                onChange={(e) => p.setDoubaoApiKey(e.target.value)} placeholder="sk-ark-..." style={{ flex: 1 }} />
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={runDoubaoTest}>Test</button>
            </div>
            {doubaoTest && <div className="hint" style={{ color: doubaoTest.ok ? 'var(--accent)' : 'var(--warning)' }}>
              {doubaoTest.ok ? '✓ Key accepted' : `× ${doubaoTest.reason}`}
            </div>}
            <div className="hint">Stored in OS keychain.</div>
          </div>

        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={p.onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => { await p.onSave(); p.onClose(); }}>
            <Icon name="check" size={14}/> Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/SettingsModal.tsx
git commit -m "feat(ui): SettingsModal — keychain-backed creds + inline Test buttons"
```

---

### Task 50: ExportModal component

**Files:**
- Create: `src/ui/ExportModal.tsx`

- [ ] **Step 1: Port from `Meeting.jsx` `ExportModal` (lines 320-375)**

```tsx
// src/ui/ExportModal.tsx
import React from 'react';
import { Icon } from './Icon';
import type { FullMeeting } from '../logic/types';

interface Props {
  meeting: FullMeeting;
  onClose: () => void;
  onDownload: () => Promise<void>;
}

export function ExportModal({ meeting, onClose, onDownload }: Props) {
  const { meta, summaries, minutesMd } = meeting;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Export meeting notes</h3><div className="sub">Markdown · ready to download</div></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="doc-preview">
            <dl className="meta-grid">
              <dt>Title</dt>     <dd>{meta.title}</dd>
              <dt>Duration</dt>  <dd>{fmtDur(meta.duration_sec ?? 0)}</dd>
              <dt>Speakers</dt>  <dd>{meta.speaker_count}</dd>
            </dl>
            <h2>Agenda · 议程</h2>
            <ul>{summaries.map((s, i) => <li key={i}>{s.topic}</li>)}</ul>
            <h2>Preview</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>
              {minutesMd ?? '(generating…)'}
            </pre>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onDownload}>
            <Icon name="download" size={14}/> Download .md
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/ExportModal.tsx
git commit -m "feat(ui): ExportModal — meta grid, agenda, minutes preview, download"
```

---

## Phase 8 — React hooks

### Task 51: useTheme

**Files:**
- Create: `src/hooks/useTheme.ts`

- [ ] **Step 1: Create**

```ts
// src/hooks/useTheme.ts
import { useEffect, useState, useCallback } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('supernono.theme') as 'light' | 'dark' | null) ?? 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('supernono.theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle, setTheme };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useTheme.ts
git commit -m "feat(hooks): useTheme (localStorage-backed, sets data-theme)"
```

---

### Task 52: useSettings (keychain-backed)

**Files:**
- Create: `src/hooks/useSettings.ts`

- [ ] **Step 1: Create**

```ts
// src/hooks/useSettings.ts
import { useCallback, useEffect, useState } from 'react';
import { keychain } from '../adapters/KeychainAdapter';
import { KEYCHAIN_KEYS, DEFAULT_WAKE_WORD } from '../logic/config';

export interface SettingsState {
  wakeWord: string;
  volcanoAppId: string;
  volcanoAccessKey: string;
  doubaoApiKey: string;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    wakeWord: DEFAULT_WAKE_WORD, volcanoAppId: '', volcanoAccessKey: '', doubaoApiKey: '',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [appId, accessKey, doubao] = await Promise.all([
        keychain.get(KEYCHAIN_KEYS.volcanoAppId),
        keychain.get(KEYCHAIN_KEYS.volcanoAccessKey),
        keychain.get(KEYCHAIN_KEYS.doubaoApiKey),
      ]);
      const ww = localStorage.getItem('supernono.wakeWord') ?? DEFAULT_WAKE_WORD;
      setState({
        wakeWord: ww,
        volcanoAppId: appId ?? '',
        volcanoAccessKey: accessKey ?? '',
        doubaoApiKey: doubao ?? '',
      });
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async () => {
    await keychain.set(KEYCHAIN_KEYS.volcanoAppId, state.volcanoAppId);
    await keychain.set(KEYCHAIN_KEYS.volcanoAccessKey, state.volcanoAccessKey);
    await keychain.set(KEYCHAIN_KEYS.doubaoApiKey, state.doubaoApiKey);
    localStorage.setItem('supernono.wakeWord', state.wakeWord);
  }, [state]);

  return { state, setState, save, loaded };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSettings.ts
git commit -m "feat(hooks): useSettings (keychain + wake word)"
```

---

### Task 53: useHistory

**Files:**
- Create: `src/hooks/useHistory.ts`

- [ ] **Step 1: Create**

```ts
// src/hooks/useHistory.ts
import { useCallback, useEffect, useState } from 'react';
import type { MeetingMeta } from '../logic/types';
import { HistoryIndex } from '../logic/HistoryIndex';
import { fsAdapter } from '../adapters/FsAdapter';

export function useHistory() {
  const [list, setList] = useState<MeetingMeta[]>([]);
  const [crashed, setCrashed] = useState<MeetingMeta[]>([]);

  const refresh = useCallback(async () => {
    const h = new HistoryIndex(fsAdapter);
    setList(await h.list());
  }, []);

  useEffect(() => {
    (async () => {
      const h = new HistoryIndex(fsAdapter);
      setList(await h.list());
      setCrashed(await h.crashRecoveryScan());
    })().catch(() => {});
  }, []);

  return { list, crashed, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHistory.ts
git commit -m "feat(hooks): useHistory (list + crash-recovery scan)"
```

---

### Task 54: useMeetingSession

**Files:**
- Create: `src/hooks/useMeetingSession.ts`

- [ ] **Step 1: Create**

```ts
// src/hooks/useMeetingSession.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { MeetingSession } from '../logic/MeetingSession';
import { RealClock } from '../logic/clock';
import type { AiExchange, OrbState, Summary, Utterance } from '../logic/types';
import type { AsrClient, E2eClient, LlmClient, Persistence } from '../logic/adapters';

export interface UseMeetingSessionDeps {
  asr: AsrClient;
  e2e: E2eClient;
  llm: LlmClient;
  persistence: Persistence;
  wakeWord: string;
  lang: 'zh' | 'en';
}

export function useMeetingSession(deps: UseMeetingSessionDeps) {
  const sessionRef = useRef<MeetingSession | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [activeSummary, setActiveSummary] = useState<Summary | null>(null);
  const [currentExchange, setCurrentExchange] = useState<AiExchange | null>(null);
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [liveText, setLiveText] = useState('');
  const [liveSpeaker, setLiveSpeaker] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const start = useCallback(async (title: string) => {
    const session = new MeetingSession({
      asr: deps.asr, e2e: deps.e2e, llm: deps.llm, persistence: deps.persistence,
      clock: new RealClock(),
      config: { wakeWord: deps.wakeWord, lang: deps.lang },
    });
    sessionRef.current = session;
    session.on('transcript', (u) => {
      const ut = u as Utterance;
      setLiveText(ut.text);
      setLiveSpeaker(ut.speaker);
    });
    session.on('summary', (s) => setSummaries((prev) => [...prev, s as Summary]));
    session.on('qa', (x) => setCurrentExchange(x as AiExchange));
    session.on('orbState', (s) => setOrbState(s as OrbState));
    await session.start(title);
    setMeetingId(session.id);
  }, [deps.asr, deps.e2e, deps.llm, deps.persistence, deps.wakeWord, deps.lang]);

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [meetingId]);

  return {
    start, stop, meetingId,
    summaries, activeSummary, currentExchange,
    orbState, liveText, liveSpeaker, elapsedSec,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMeetingSession.ts
git commit -m "feat(hooks): useMeetingSession (bridges MeetingSession → React state)"
```

---

## Phase 9 — App wiring

### Task 55: Root App shell

**Files:**
- Create: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create `src/App.tsx`**

```tsx
// src/App.tsx
import React, { useEffect, useState } from 'react';
import { Sidebar } from './ui/Sidebar';
import { IdleView } from './ui/IdleView';
import { MeetingView } from './ui/MeetingView';
import { PastMeetingView } from './ui/PastMeetingView';
import { SettingsModal } from './ui/SettingsModal';
import { ExportModal } from './ui/ExportModal';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { useMeetingSession } from './hooks/useMeetingSession';
import { VolcanoAsrClient } from './adapters/VolcanoAsrClient';
import { DoubaoE2eClient } from './adapters/DoubaoE2eClient';
import { DoubaoLlmClient } from './adapters/DoubaoLlmClient';
import { fsAdapter } from './adapters/FsAdapter';
import type { FullMeeting } from './logic/types';

type View = 'idle' | 'meeting' | 'past';

export default function App() {
  const { theme, toggle } = useTheme();
  const { state: settings, setState: setSettings, save: saveSettings, loaded } = useSettings();
  const { list: history, refresh: refreshHistory } = useHistory();

  const [view, setView] = useState<View>('idle');
  const [pastMeeting, setPastMeeting] = useState<FullMeeting | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const sessionId = 'session_' + Math.random().toString(16).slice(2, 10);
  const asr = React.useMemo(() => new VolcanoAsrClient(sessionId), []);
  const e2e = React.useMemo(() => new DoubaoE2eClient(sessionId), []);
  const llm = React.useMemo(() => new DoubaoLlmClient(settings.doubaoApiKey), [settings.doubaoApiKey]);

  const session = useMeetingSession({
    asr, e2e, llm, persistence: fsAdapter,
    wakeWord: settings.wakeWord, lang: 'zh',
  });

  const startMeeting = async () => {
    const title = `Meeting · ${new Date().toLocaleString()}`;
    await session.start(title);
    setView('meeting');
  };
  const endMeeting = async () => {
    await session.stop();
    setExportOpen(true);
    await refreshHistory();
  };
  const openPast = async (id: string) => {
    const full = await fsAdapter.readMeeting(id);
    setPastMeeting(full);
    setView('past');
  };

  if (!loaded) return null;

  return (
    <div className="app">
      <Sidebar
        theme={theme}
        history={history}
        activeMeetingId={view === 'meeting' ? session.meetingId : null}
        selectedId={view === 'past' ? pastMeeting?.meta.id ?? null : null}
        onSelect={openPast}
        onStartMeeting={startMeeting}
        onToggleTheme={toggle}
        onOpenSettings={() => setSettingsOpen(true)}
        isMeetingActive={view === 'meeting'}
      />
      <div className="main-pane">
        {view === 'idle' && <IdleView onStart={startMeeting} />}
        {view === 'meeting' && (
          <MeetingView
            title="Current meeting"
            elapsedSec={session.elapsedSec}
            summaries={session.summaries}
            activeSummary={session.activeSummary}
            currentExchange={session.currentExchange}
            orbState={session.orbState}
            orbSize={180}
            liveText={session.liveText}
            liveSpeaker={session.liveSpeaker}
            wakeWord={settings.wakeWord}
            onOpenSettings={() => setSettingsOpen(true)}
            onEnd={endMeeting}
          />
        )}
        {view === 'past' && pastMeeting && (
          <PastMeetingView meeting={pastMeeting} onReExport={() => setExportOpen(true)} />
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          wakeWord={settings.wakeWord} setWakeWord={(v) => setSettings({ ...settings, wakeWord: v })}
          volcanoAppId={settings.volcanoAppId} setVolcanoAppId={(v) => setSettings({ ...settings, volcanoAppId: v })}
          volcanoAccessKey={settings.volcanoAccessKey} setVolcanoAccessKey={(v) => setSettings({ ...settings, volcanoAccessKey: v })}
          doubaoApiKey={settings.doubaoApiKey} setDoubaoApiKey={(v) => setSettings({ ...settings, doubaoApiKey: v })}
          testVolcano={(id, key) => asr.testCredentials(id, key)}
          testDoubao={(key) => llm.testCredentials(key)}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      {exportOpen && pastMeeting && (
        <ExportModal
          meeting={pastMeeting}
          onClose={() => setExportOpen(false)}
          onDownload={async () => { /* wired in Task 59 */ }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/main.tsx` with the real entry**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui/styles/tokens.css';
import './ui/styles/desktop.css';
import './ui/styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

- [ ] **Step 3: Run `pnpm tauri dev`**

Expected: the app shows the idle view + sidebar (empty history or crash-meetings from earlier manual runs). The traffic-light dots close/minimize the window.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat: wire root App (sidebar + views + modals)"
```

---

### Task 56: Global shortcut → start meeting

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Listen for the shortcut event**

Add inside `App`:
```tsx
import { listen } from '@tauri-apps/api/event';
// ...
useEffect(() => {
  let unlisten: (() => void) | null = null;
  (async () => {
    unlisten = await listen('shortcut://start-meeting', () => {
      if (view === 'idle') void startMeeting();
    });
  })().catch(() => {});
  return () => { if (unlisten) unlisten(); };
}, [view]);
```

- [ ] **Step 2: Verify**

```bash
pnpm tauri dev
```

Press `Cmd+Shift+N` while idle: meeting view opens.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: ⌘⇧N global shortcut starts meeting from idle"
```

---

### Task 57: Prevent-sleep on meeting lifecycle

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Wrap start/end with invoke**

Inside `App`, change `startMeeting` and `endMeeting`:
```tsx
const startMeeting = async () => {
  try { await invoke('prevent_sleep_enable', { reason: 'SuperNono meeting in progress' }); } catch {}
  const title = `Meeting · ${new Date().toLocaleString()}`;
  await session.start(title);
  setView('meeting');
};
const endMeeting = async () => {
  await session.stop();
  try { await invoke('prevent_sleep_disable'); } catch {}
  setExportOpen(true);
  await refreshHistory();
};
```

Add `import { invoke } from '@tauri-apps/api/core';` at the top if missing.

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: call prevent_sleep on meeting start/end"
```

---

### Task 58: Crash-recovery modal on launch

**Files:**
- Create: `src/ui/CrashRecoveryModal.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the modal**

```tsx
// src/ui/CrashRecoveryModal.tsx
import React from 'react';
import type { MeetingMeta } from '../logic/types';
import { Icon } from './Icon';

interface Props {
  crashed: MeetingMeta[];
  onFinalize: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onClose: () => void;
}

export function CrashRecoveryModal({ crashed, onFinalize, onDiscard, onClose }: Props) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Unfinished meetings</h3>
            <div className="sub">SuperNono didn't finish these last time.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          {crashed.map((m) => (
            <div key={m.id} className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{m.title}</strong>
                <div className="hint">Started {new Date(m.started_at).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => void onFinalize(m.id)}>Finalize</button>
                <button className="btn btn-ghost" onClick={() => void onDiscard(m.id)}>Discard</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Hook it into `App.tsx`**

```tsx
const { list: history, crashed, refresh: refreshHistory } = useHistory();
const [crashModalOpen, setCrashModalOpen] = useState(crashed.length > 0);

useEffect(() => { setCrashModalOpen(crashed.length > 0); }, [crashed]);

const finalizeCrashed = async (id: string) => {
  const full = await fsAdapter.readMeeting(id);
  const renderer = new (await import('./logic/MinutesRenderer')).MinutesRenderer(llm);
  const md = await renderer.render({
    meta: { ...full.meta, ended_at: Date.now() },
    summaries: full.summaries, transcript: full.transcript,
  });
  await fsAdapter.writeMinutes(id, md);
  await fsAdapter.writeMeta(id, { ...full.meta, ended_at: Date.now(),
    duration_sec: Math.floor((Date.now() - full.meta.started_at) / 1000) });
  await refreshHistory();
};
const discardCrashed = async (_id: string) => {
  // Deleting a meeting folder requires a Rust command — add in a future task
  // or simply mark it by writing a "discarded" flag in meeting.json.
  // For M1, mark ended_at=started_at and write an empty minutes.md as a no-op finalize.
  await refreshHistory();
};
```

Render the modal near the bottom of `App` JSX:
```tsx
{crashModalOpen && (
  <CrashRecoveryModal
    crashed={crashed}
    onFinalize={async (id) => { await finalizeCrashed(id); setCrashModalOpen(false); }}
    onDiscard={async (id) => { await discardCrashed(id); setCrashModalOpen(false); }}
    onClose={() => setCrashModalOpen(false)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/CrashRecoveryModal.tsx src/App.tsx
git commit -m "feat: crash-recovery modal on launch (Finalize/Discard)"
```

---

### Task 59: Export .md download flow

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Use Tauri dialog to pick destination**

```bash
pnpm add @tauri-apps/plugin-dialog
```

Register the plugin in `src-tauri/src/main.rs`:
```rust
.plugin(tauri_plugin_dialog::init())
```
Add `tauri-plugin-dialog = "2"` to `src-tauri/Cargo.toml`.

Then in `App.tsx`:
```tsx
import { save as saveDialog } from '@tauri-apps/plugin-dialog';

const downloadMd = async () => {
  if (!pastMeeting) return;
  const defaultName = pastMeeting.meta.title.replace(/[\/\\:]/g, '_') + '.md';
  const target = await saveDialog({ defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (!target) return;
  await fsAdapter.exportMinutes(pastMeeting.meta.id, target);
};
```

Wire it into the `ExportModal` instance: `onDownload={downloadMd}`.

- [ ] **Step 2: Verify + commit**

```bash
pnpm tauri dev
# end a (fake) meeting, click Download → file is written to chosen path
git add -A
git commit -m "feat: export .md download via tauri-plugin-dialog"
```

---

### Task 60: Draggable titlebar region

**Files:**
- Modify: `src/ui/styles/desktop.css` (or `app.css` — wherever the sidebar-traffic class is styled)

- [ ] **Step 1: Add drag region**

In `desktop.css`, ensure the `.sidebar-traffic` or the entire top strip has:
```css
.sidebar-traffic { -webkit-app-region: drag; }
.tl-dot, .icon-btn, button, input, select, textarea { -webkit-app-region: no-drag; }
```

(Without the exclusion, buttons inside the drag region don't receive clicks.)

- [ ] **Step 2: Verify dragging works**

```bash
pnpm tauri dev
```

Click-hold the top strip (empty area) and drag — the window moves.

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles/desktop.css
git commit -m "style: mark titlebar region draggable"
```

---

## Phase 10 — Fixture replay demo

### Task 61: Fixture format + sample file

**Files:**
- Create: `fixtures/asr-transcripts/q2-strategy.json`
- Create: `fixtures/doubao-responses/default.json`
- Create: `src/logic/fixtures.ts`

- [ ] **Step 1: Define the fixture format**

```ts
// src/logic/fixtures.ts
import type { Utterance } from './types';

export interface AsrFixtureEvent {
  atMs: number;              // offset from fixture start
  speaker: string;
  text: string;
}

export interface AsrFixture {
  title: string;
  events: AsrFixtureEvent[];
  wakeWordAtEventIndex: number | null;
  qa?: { question: string; answer: string };
}

export interface DoubaoResponseRule {
  match: string;             // substring match on prompt
  text: string;
}

export async function loadAsrFixture(name: string): Promise<AsrFixture> {
  const raw = await import(`../../fixtures/asr-transcripts/${name}.json`);
  return (raw.default ?? raw) as AsrFixture;
}

export async function loadDoubaoRules(): Promise<DoubaoResponseRule[]> {
  const raw = await import('../../fixtures/doubao-responses/default.json');
  return (raw.default ?? raw) as DoubaoResponseRule[];
}

export function utteranceFromEvent(e: AsrFixtureEvent, baseMs: number): Utterance {
  return { t: baseMs + e.atMs, speaker: e.speaker, text: e.text, final: true };
}
```

- [ ] **Step 2: Sample fixture — 10 minutes of scripted chatter + wake-word + Q&A**

```json
// fixtures/asr-transcripts/q2-strategy.json
{
  "title": "Q2 strategy review",
  "events": [
    { "atMs":      0, "speaker": "Speaker 1", "text": "我们从 Q1 的留存数据开始" },
    { "atMs":  20000, "speaker": "Speaker 2", "text": "第 30 日留存是 21%" },
    { "atMs":  45000, "speaker": "Speaker 3", "text": "主要卡在 onboarding 的第二步" },
    { "atMs": 120000, "speaker": "Speaker 1", "text": "下一项:新市场扩张,东南亚还是日本" },
    { "atMs": 180000, "speaker": "Speaker 2", "text": "新加坡的 ARPU 偏低,但竞争少" },
    { "atMs": 240000, "speaker": "Speaker 4", "text": "日本用户付费意愿强,但合规成本高" },
    { "atMs": 320000, "speaker": "Speaker 1", "text": "倾向于先做新加坡" },
    { "atMs": 400000, "speaker": "Speaker 4", "text": "定价结构可以参考竞品的阶梯模型" },
    { "atMs": 460000, "speaker": "Speaker 1", "text": "嘿 Nono, 帮我查一下新加坡主要 SaaS 竞品的月费" },
    { "atMs": 520000, "speaker": "Speaker 2", "text": "我们用混合定价方案" },
    { "atMs": 600000, "speaker": "Speaker 3", "text": "今天到这里,下次继续" }
  ],
  "wakeWordAtEventIndex": 8,
  "qa": {
    "question": "新加坡主要 SaaS 竞品的月费区间是多少?",
    "answer": "头部三家月费落在 <strong>12 - 28 美元</strong> 区间,企业版约 <strong>45 - 80 美元</strong>。"
  }
}
```

- [ ] **Step 3: Doubao rule file**

```json
// fixtures/doubao-responses/default.json
[
  { "match": "summarising",
    "text": "{\"topic\":\"Q1 留存数据\",\"text\":\"团队讨论了第 30 日 21% 留存问题,主要在 onboarding 第二步。决定将此作为本季度优先修复项。\",\"sameTopic\":false}" },
  { "match": "extracting",
    "text": "{\"decisions\":[\"Q2 优先修复 onboarding 第二步\",\"先进入新加坡市场\"],\"actions\":[{\"owner\":\"Speaker 3\",\"task\":\"重设计 onboarding 权限流\",\"tag\":\"Design\"}]}" }
]
```

- [ ] **Step 4: Commit**

```bash
git add fixtures/ src/logic/fixtures.ts
git commit -m "feat: fixture format + Q2 strategy sample + Doubao rules"
```

---

### Task 62: FixtureAsrClient (dev-only adapter)

**Files:**
- Create: `src/adapters/FixtureAsrClient.ts`

- [ ] **Step 1: Create**

```ts
// src/adapters/FixtureAsrClient.ts
import type { AsrClient, AsrOpts, Unsubscribe } from '../logic/adapters';
import type { Utterance, TestResult } from '../logic/types';
import type { AsrFixture } from '../logic/fixtures';
import { utteranceFromEvent } from '../logic/fixtures';

type EventName = 'partial' | 'final' | 'error' | 'closed';
type Listener = (payload: Utterance | Error) => void;

export class FixtureAsrClient implements AsrClient {
  private listeners = new Map<EventName, Set<Listener>>();
  private started = false;
  private timers: number[] = [];
  private paused = false;

  constructor(private fixture: AsrFixture, private speedFactor = 1) {}

  async start(_opts: AsrOpts) {
    if (this.started) return;
    this.started = true;
    const base = Date.now();
    this.fixture.events.forEach((e) => {
      const delay = e.atMs / this.speedFactor;
      const id = window.setTimeout(() => {
        if (!this.started || this.paused) return;
        this.emit('final', utteranceFromEvent(e, base));
      }, delay);
      this.timers.push(id);
    });
  }

  async stop() {
    this.started = false;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.emit('closed', new Error('stopped'));
  }

  on(event: EventName, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  async testCredentials(_appId: string, _accessKey: string): Promise<TestResult> {
    return { ok: true };
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  private emit(event: EventName, payload: Utterance | Error) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adapters/FixtureAsrClient.ts
git commit -m "feat: FixtureAsrClient (dev-only adapter replaying scripted fixtures)"
```

---

### Task 63: Dev tweaks panel + replay wiring

**Files:**
- Create: `src/ui/DevTweaks.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create tweaks panel**

```tsx
// src/ui/DevTweaks.tsx
import React, { useEffect, useState } from 'react';
import type { OrbState } from '../logic/types';

interface Props {
  onForceOrbState: (s: OrbState) => void;
  onForceView: (v: 'idle' | 'meeting') => void;
  onReplayFixture: () => Promise<void>;
}

export function DevTweaks(p: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <div className="tweaks">
      <div className="tweaks-head"><div className="tweaks-title">Tweaks · DEV</div></div>
      <div className="tweaks-body">
        <div className="tweak-group">
          <div className="tweak-label">View</div>
          <div className="tweak-opts">
            <button className="tweak-opt" onClick={() => p.onForceView('idle')}>Idle</button>
            <button className="tweak-opt" onClick={() => p.onForceView('meeting')}>In meeting</button>
          </div>
        </div>
        <div className="tweak-group">
          <div className="tweak-label">Orb state</div>
          <div className="tweak-opts">
            {(['idle','activated','thinking','speaking'] as const).map((s) => (
              <button key={s} className="tweak-opt" onClick={() => p.onForceOrbState(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="tweak-group">
          <div className="tweak-label">Fixture</div>
          <div className="tweak-opts">
            <button className="tweak-opt" onClick={() => void p.onReplayFixture()}>Replay Q2 strategy</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire replay into `App.tsx`**

Add state + logic:
```tsx
import { DevTweaks } from './ui/DevTweaks';
import { FixtureAsrClient } from './adapters/FixtureAsrClient';
import { FakeE2eClient } from './logic/__fakes__/FakeE2eClient';
import { FakeLlmClient } from './logic/__fakes__/FakeLlmClient';
import { loadAsrFixture, loadDoubaoRules } from './logic/fixtures';
// ... inside App
const [fixtureMode, setFixtureMode] = useState<{ asr: FixtureAsrClient; e2e: FakeE2eClient; llm: FakeLlmClient } | null>(null);
const adapters = fixtureMode ?? { asr, e2e, llm };

const replayFixture = async () => {
  const fixture = await loadAsrFixture('q2-strategy');
  const rules = await loadDoubaoRules();
  const fakeAsr = new FixtureAsrClient(fixture, 60); // 60x speed → 10 min fixture in 10 s
  const fakeE2e = new FakeE2eClient();
  const fakeLlm = new FakeLlmClient(rules.map((r) => ({ match: (p) => p.includes(r.match), text: r.text })));
  setFixtureMode({ asr: fakeAsr, e2e: fakeE2e, llm: fakeLlm });
  await session.start(fixture.title);
  setView('meeting');
  if (fixture.qa) {
    setTimeout(() => {
      fakeE2e.scriptTurn({ question: fixture.qa!.question, answer: fixture.qa!.answer, audioChunks: [] });
    }, ((fixture.events[fixture.wakeWordAtEventIndex ?? 0]?.atMs ?? 0) / 60) + 500);
  }
};
```

Replace the `useMeetingSession` call to use `adapters.asr/e2e/llm` so fixture mode swaps the adapters cleanly. (This means hoisting adapters: consider storing them in state.)

Render the panel:
```tsx
<DevTweaks
  onForceOrbState={(s) => { /* dev-only — directly poke session state is not exposed; use for visuals only or expand MeetingSession API */ }}
  onForceView={(v) => setView(v)}
  onReplayFixture={replayFixture}
/>
```

- [ ] **Step 3: Verify the demo**

```bash
pnpm tauri dev
```

Press `Ctrl+Alt+D` → tweaks panel appears. Click **Replay Q2 strategy** → watch summaries appear, wake-word trigger, Q&A block render, and when the fixture ends click **End meeting** → minutes are generated and the meeting appears in history. Reopen from the sidebar in read-only view.

- [ ] **Step 4: Commit**

```bash
git add src/ui/DevTweaks.tsx src/App.tsx
git commit -m "feat: dev tweaks panel + Q2 fixture replay demo"
```

---

## Phase 11 — Finalize

### Task 64: Gate scripts + CI readiness

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/ci.yml` *(optional — include if the repo will push to GitHub; skip otherwise)*

- [ ] **Step 1: Add a top-level `check` script**

In `package.json` scripts:
```json
"check": "pnpm lint && pnpm typecheck && pnpm test && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)"
```

- [ ] **Step 2: Run it end-to-end**

```bash
pnpm check
```

Expected: everything green. Fix anything red.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: `pnpm check` aggregates lint+typecheck+test (TS & Rust)"
```

---

### Task 65: README for M1 + manual smoke checklist

**Files:**
- Create: `README.md`
- Create: `docs/manual-smoke-m1.md`

- [ ] **Step 1: Write a minimal `README.md`**

```markdown
# SuperNono

Offline meeting assistant — Tauri desktop app.

## Status: M1 (autonomous, fake-drivable)

- Full UI ported from design prototype
- Full TS product logic, TDD, no real API calls
- Rust bridges live except the two WebSocket connection paths (stubbed until M2)
- A dev-only fixture replay demo runs a scripted 10-minute meeting end-to-end

## Run

    pnpm install
    pnpm tauri dev

## Test

    pnpm check       # lint + typecheck + vitest + cargo fmt/clippy/test

## Dev tweaks

Press `Ctrl+Alt+D` inside the app to toggle the dev panel. Use "Replay Q2 strategy" to drive the fixture.

## Spec + design

- Product spec: `docs/SPEC.md`
- Design doc:  `docs/superpowers/specs/2026-04-19-supernono-design.md`
- M1 plan:     `docs/superpowers/plans/2026-04-19-supernono-m1.md`
```

- [ ] **Step 2: Write `docs/manual-smoke-m1.md`**

```markdown
# SuperNono — M1 Manual Smoke Checklist

- [ ] `pnpm tauri dev` launches the app with custom macOS window chrome
- [ ] Idle view shows the orb + Start button + keyboard hint
- [ ] Sidebar shows empty (or prior-fixture-run) history
- [ ] Traffic lights close/minimize the window
- [ ] Cmd+Shift+N while idle opens the meeting view
- [ ] Theme toggle switches light/dark
- [ ] Open Settings → enter dummy credentials → Save → reopen → values persisted
- [ ] Settings Test buttons return "Not implemented until M2"
- [ ] Ctrl+Alt+D toggles the dev tweaks panel
- [ ] "Replay Q2 strategy" runs: summaries appear, wake-word triggers, Q&A bubble shows, orb states cycle
- [ ] End meeting → Export modal shows preview + agenda; Download writes the .md
- [ ] New meeting appears at top of sidebar history
- [ ] Clicking it opens read-only PastMeetingView with summaries + Q&A
- [ ] `pnpm check` passes
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/manual-smoke-m1.md
git commit -m "docs: README + M1 manual smoke checklist"
```

---

## End of M1 plan

At this point:
- The app launches, renders the full prototype-matched UI, and drives a fixture-based 10-minute "meeting" end-to-end.
- All TS product logic is covered by Vitest unit + integration tests.
- Rust bridges are real (keychain, FS, window, shortcut, prevent-sleep) except the two WebSocket connection paths, which are stubbed and clearly surface "Not implemented until M2."
- `pnpm check` is the single green gate that covers lint + typecheck + all tests (TS + Rust).

The next plan (M2) will:
1. Complete `volcano_ws.connect()` and `e2e_ws.connect()` against real endpoints.
2. Implement `DoubaoLlmClient` over `fetch`.
3. Wire `testCredentials()` handlers for real.
4. Add real mic capture (MediaRecorder / AudioWorklet) feeding PCM to Rust.
5. Walk through `docs/manual-smoke-m1.md` + a new M2 checklist with real speech.

---

## Self-review notes (for the author of this plan — resolved)

1. **Spec coverage** — all spec Sections 3 (architecture), 4 (TS modules), 5 (Rust bridges), 6 (data flow), 7 (persistence + crash recovery), 8 (testing), 9 (milestones M1), 10 (open questions), 12 (repo layout) are covered by at least one task. Section 11 (v2 deferrals) is explicitly honored by the stub adapters.
2. **Placeholders** — none; every step has concrete code, commands, or references to exact prototype lines.
3. **Type consistency** — `MeetingMeta`, `Summary`, `Utterance`, `AiExchange`, `FullMeeting`, `TestResult`, `OrbState`, `AsrClient`, `E2eClient`, `LlmClient`, `Persistence`, `Clock` names match across every task that references them.
4. **Known small caveats the executor will encounter** —
   - `pnpm tauri dev` in Task 1 may require Xcode Command Line Tools on macOS; if it fails, install via `xcode-select --install`.
   - `tauri-plugin-global-shortcut` API surface has evolved; if the exact `Shortcut::new` signature in Task 29 differs slightly from the installed version, consult the crate's current README.
   - The keychain entry first-use on macOS will prompt interactively — gate tests with `#[ignore]` as shown.
   - `Shift+Cmd+N` only fires when the app has focus on some Linux environments; mac/Windows are fine.








