# SuperNono

Offline meeting assistant — Tauri 2 desktop app.

Open the app in a meeting room, press **Start Meeting**, and it continuously transcribes the discussion, generates rolling topic summaries every ~5 minutes, answers voice questions on a wake word ("嘿 Nono"), and writes a Markdown minutes document when you end the meeting.

## Status

**M2 shipped** — real-time ASR, wake-word Q&A with TTS answer, rolling summaries, Markdown minutes export, credential test buttons, WS reconnect with backoff, macOS + Windows prevent-sleep. See `docs/manual-smoke-m2.md` for the full verification checklist.

## Services used

The app calls three Volcano Engine products. You need to enable each one in your Volcano account and obtain the corresponding credentials.

| Service | What it does here | Endpoint | Resource ID |
|---|---|---|---|
| 豆包·流式语音识别大模型 (Doubao Streaming ASR) | Real-time transcription of the meeting | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` | `volc.bigasr.sauc.duration` |
| 豆包·端到端实时语音大模型 (Doubao E2E Realtime) | Wake-word Q&A: listens to the user's question after "嘿 Nono", answers aloud via TTS | `wss://openspeech.bytedance.com/api/v3/realtime/dialogue` | `volc.speech.dialog` |
| 豆包·大语言模型 (Doubao via Ark) | Rolling topic summaries every ~5 min + final meeting minutes on end | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | Model `doubao-1-5-pro-256k` |

### Where to open services and get credentials

Full click-by-click walkthrough: **[docs/credentials-guide.md](docs/credentials-guide.md)** (Chinese). Summary:

| You need | Exact page |
|---|---|
| App ID + Access Token (cover both WSS services) | <https://console.volcengine.com/speech/service/10038> (流式语音识别) and <https://console.volcengine.com/speech/service/10017> (端到端) |
| Doubao API Key (Ark) | <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey> |

⚠ **The Ark API key is different from your general Volcano Engine API Key.** It must be created inside the Ark console specifically; otherwise Doubao will return `HTTP 401: The API key doesn't exist`.

Enter all three in **Settings → 豆包语音凭证**; the test buttons verify each live handshake before you start a meeting. Credentials are stored in the OS keychain (macOS Keychain, Windows Credential Manager).

## Data & privacy

- Meetings persist locally under the OS app-data directory (macOS: `~/Library/Application Support/com.supernono.app/`). No cloud sync in M2.
- Audio streams to Volcano/Doubao during a meeting for ASR + Q&A. No audio is stored in the cloud beyond the request lifecycle.
- Credentials never leave the machine except to authenticate Volcano/Doubao requests.

## Run

```sh
pnpm install
pnpm tauri dev
```

Requires Node 22.14+ and pnpm 10.29+. macOS or Windows.

On first launch, macOS will prompt for microphone access — grant it. If you miss the prompt or previously denied, open **System Settings → Privacy & Security → Microphone** and enable SuperNono; the in-app "Open system settings" button links there directly.

## Test

```sh
pnpm check       # lint + typecheck + vitest + cargo fmt/clippy/test
```

Integration test against a local mock WS server (opt-in):

```sh
cd src-tauri && cargo test --features ws-integration
```

## Dev tweaks

Press `Ctrl+Alt+D` inside the app to toggle the dev panel. "Replay Q2 strategy" drives a fixture-scripted meeting end-to-end without real credentials (summaries won't appear in the 10-second demo because `SummaryScheduler` uses the real 5-minute clock — known limitation).

### Verify credentials from the command line

Useful during development (no GUI needed):

```sh
# 1. Put APP_ID, ACCESS_TOKEN, VOLCANO_ENGINE_API_KEY in config/secrets (gitignored)
# 2. Run the smoke binary; it hits all three real endpoints
cd src-tauri && cargo run --example smoke_credentials
```

Each service reports pass/fail with the server `logid` so you can forward it to Volcano support if a credential is misbehaving.

## Spec + design

- Product spec: `docs/SPEC.md`
- M1 design: `docs/superpowers/specs/2026-04-19-supernono-design.md`
- M1 plan: `docs/superpowers/plans/2026-04-19-supernono-m1.md`
- M2 design: `docs/superpowers/specs/2026-04-19-supernono-m2-design.md`
- M2 plan: `docs/superpowers/plans/2026-04-19-supernono-m2.md`

## Troubleshooting

- **Volcano test shows `HTTP 401` or `auth`** — check App ID matches the one on the Volcano speech console; re-issue the Access Token if needed.
- **Doubao test shows `HTTP 401`** — API Key from *Ark* console (not speech console). These are two separate credential systems.
- **Volcano test shows `timeout` or `network`** — firewall may block `openspeech.bytedance.com:443` outbound. Try a different network.
- **Meeting starts but no transcripts appear** — confirm mic permission was granted; watch the Orb for amplitude response when you speak.
