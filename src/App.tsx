import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Sidebar } from './ui/Sidebar';
import { IdleView } from './ui/IdleView';
import { MeetingView } from './ui/MeetingView';
import { PastMeetingView } from './ui/PastMeetingView';
import { SettingsModal } from './ui/SettingsModal';
import { ExportModal } from './ui/ExportModal';
import { CrashRecoveryModal } from './ui/CrashRecoveryModal';
import { MinutesRenderer } from './logic/MinutesRenderer';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { useMeetingSession } from './hooks/useMeetingSession';
import { VolcanoAsrClient } from './adapters/VolcanoAsrClient';
import { DoubaoE2eClient } from './adapters/DoubaoE2eClient';
import { LlmClient } from './adapters/LlmClient';
import { FixtureAsrClient } from './adapters/FixtureAsrClient';
import { fsAdapter } from './adapters/FsAdapter';
import { DevTweaks } from './ui/DevTweaks';
import { MicCapture } from './audio/MicCapture';
import { FakeE2eClient } from './logic/__fakes__/FakeE2eClient';
import { FakeLlmClient } from './logic/__fakes__/FakeLlmClient';
import { loadAsrFixture, loadDoubaoRules } from './logic/fixtures';
import type { FullMeeting } from './logic/types';

const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_COLLAPSE_THRESHOLD = 140;

type View = 'idle' | 'meeting' | 'past';

export default function App() {
  const { theme, toggle } = useTheme();
  const { state: settings, setState: setSettings, save: saveSettings, loaded } = useSettings();
  const { list: history, crashed, refresh: refreshHistory, refreshCrashed } = useHistory();
  const [crashModalOpen, setCrashModalOpen] = useState(false);

  const [view, setView] = useState<View>('idle');
  const [pastMeeting, setPastMeeting] = useState<FullMeeting | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('supernono.sidebarWidth');
    if (saved === null) return SIDEBAR_DEFAULT;
    const n = parseInt(saved, 10);
    if (Number.isNaN(n)) return SIDEBAR_DEFAULT;
    return Math.max(0, Math.min(SIDEBAR_MAX, n));
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem('supernono.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  // Live refs for the keydown handler; populated below after `session`
  // is constructed. Using refs keeps the listener stable across renders.
  const sessionForKeyRef = useRef<{ orbState: string; cancelQa: () => void }>({
    orbState: 'idle',
    cancelQa: () => {},
  });
  const viewRef = useRef(view);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarWidth((w) => (w === 0 ? SIDEBAR_DEFAULT : 0));
      } else if (
        e.key === 'Escape' &&
        viewRef.current === 'meeting' &&
        sessionForKeyRef.current.orbState !== 'idle'
      ) {
        // Cancel in-flight Q&A (fallback for when the user accidentally
        // triggered the wake word or wants to abort a long generation).
        e.preventDefault();
        sessionForKeyRef.current.cancelQa();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startSidebarResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let maxDelta = 0;
    setResizing(true);
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
      const raw = startW + delta;
      let next = raw;
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD) next = 0;
      else if (raw < SIDEBAR_MIN) next = SIDEBAR_MIN;
      else if (raw > SIDEBAR_MAX) next = SIDEBAR_MAX;
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizing(false);
      // Short click (no meaningful drag) on the handle while collapsed → reopen.
      if (maxDelta < 3 && startW === 0) {
        setSidebarWidth(SIDEBAR_DEFAULT);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [sessionId] = useState(() => 'session_' + Math.random().toString(16).slice(2, 10));
  const [fixtureMode, setFixtureMode] = useState<{
    asr: FixtureAsrClient;
    e2e: FakeE2eClient;
    llm: FakeLlmClient;
  } | null>(null);

  const realAsr = useMemo(
    () => new VolcanoAsrClient(sessionId, settings.volcanoAppId, settings.volcanoAccessKey),
    [sessionId, settings.volcanoAppId, settings.volcanoAccessKey],
  );
  const realE2e = useMemo(
    () => new DoubaoE2eClient(sessionId, settings.volcanoAppId, settings.volcanoAccessKey),
    [sessionId, settings.volcanoAppId, settings.volcanoAccessKey],
  );
  const realLlm = useMemo(
    () =>
      new LlmClient(
        settings.llmApiKey && settings.llmBaseUrl && settings.llmModel
          ? {
              baseUrl: settings.llmBaseUrl,
              model: settings.llmModel,
              apiKey: settings.llmApiKey,
              sdkShape: settings.llmSdkShape,
            }
          : null,
      ),
    [settings.llmApiKey, settings.llmBaseUrl, settings.llmModel, settings.llmSdkShape],
  );

  const asr = fixtureMode?.asr ?? realAsr;
  const e2e = fixtureMode?.e2e ?? realE2e;
  const llm = fixtureMode?.llm ?? realLlm;
  const mic = useMemo(() => new MicCapture(), []);

  const session = useMeetingSession({
    asr,
    e2e,
    llm,
    mic,
    persistence: fsAdapter,
    wakeWord: settings.wakeWord,
    lang: 'zh',
  });

  // Keep the keydown handler's refs up to date. Updates happen in an
  // effect (not during render) to satisfy react-hooks/refs.
  useEffect(() => {
    sessionForKeyRef.current = { orbState: session.orbState, cancelQa: session.cancelQa };
  }, [session.orbState, session.cancelQa]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const startMeeting = async () => {
    try {
      await invoke('prevent_sleep_enable', { reason: 'SuperNono meeting in progress' });
    } catch {
      /* non-Tauri env or plugin missing */
    }
    const title = `Meeting · ${new Date().toLocaleString()}`;
    try {
      await session.start(title);
      setView('meeting');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('startMeeting failed:', e);
      // If a meeting dir was created before the failure point, clean it up.
      if (session.meetingId) {
        try {
          await fsAdapter.deleteMeeting(session.meetingId);
        } catch {
          /* best effort */
        }
      }
      if (msg.includes('NotAllowed') || msg.includes('denied') || msg.includes('Permission')) {
        session.setLastError('mic_denied');
      } else {
        session.setLastError(msg || 'other');
      }
      await refreshHistory();
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await listen('shortcut://start-meeting', () => {
          if (view === 'idle') void startMeeting();
        });
      } catch {
        /* Tauri unavailable in some environments (tests) */
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const [endingMeeting, setEndingMeeting] = useState<null | {
    phase: 'generating' | 'error';
    message: string;
  }>(null);
  const endMeeting = async () => {
    setEndingMeeting({ phase: 'generating', message: '正在生成会议纪要，请稍候…' });
    try {
      await session.stop();
      try {
        await invoke('prevent_sleep_disable');
      } catch {
        /* non-Tauri */
      }
      if (session.meetingId) {
        try {
          const full = await fsAdapter.readMeeting(session.meetingId);
          setPastMeeting(full);
          setExportOpen(true);
        } catch {
          /* fsAdapter may fail in non-Tauri env */
        }
      }
      await refreshHistory();
      setEndingMeeting(null);
      setView('idle');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('endMeeting failed:', e);
      setEndingMeeting({
        phase: 'error',
        message: `结束会议时出错：${msg}。会议转写已保存，但纪要可能未生成。`,
      });
    }
  };

  const openPast = async (id: string) => {
    try {
      const full = await fsAdapter.readMeeting(id);
      setPastMeeting(full);
      setView('past');
    } catch (e) {
      console.error('failed to open past meeting', id, e);
    }
  };

  const [crashModalSeen, setCrashModalSeen] = useState(false);
  useEffect(() => {
    // Only auto-open once — don't reopen if user has dismissed it.
    if (!crashModalSeen && crashed.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCrashModalOpen(true);

      setCrashModalSeen(true);
    }
  }, [crashed, crashModalSeen]);

  const finalizeCrashed = async (id: string) => {
    try {
      const full = await fsAdapter.readMeeting(id);
      const renderer = new MinutesRenderer(llm);
      const md = await renderer.render({
        meta: { ...full.meta, ended_at: Date.now() },
        summaries: full.summaries,
        transcript: full.transcript,
      });
      await fsAdapter.writeMinutes(id, md);
      await fsAdapter.writeMeta(id, {
        ...full.meta,
        ended_at: Date.now(),
        duration_sec: Math.floor((Date.now() - full.meta.started_at) / 1000),
      });
      await refreshHistory();
    } catch {
      /* swallow; user can retry */
    }
  };

  const discardCrashed = async (id: string) => {
    try {
      await fsAdapter.deleteMeeting(id);
    } catch {
      /* best effort */
    }
    await refreshHistory();
    await refreshCrashed();
  };

  const downloadMd = async () => {
    if (!pastMeeting) return;
    const defaultName = pastMeeting.meta.title.replace(/[/\\:]/g, '_') + '.md';
    const target = await saveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!target) return;
    await fsAdapter.exportMinutes(pastMeeting.meta.id, target);
  };

  const replayFixture = async () => {
    const fixture = await loadAsrFixture('q2-strategy');
    const rules = await loadDoubaoRules();
    const fakeAsr = new FixtureAsrClient(fixture, 60); // 60x → 10min fixture in ~10s
    const fakeE2e = new FakeE2eClient();
    const fakeLlm = new FakeLlmClient(
      rules.map((r) => ({ match: (p: string) => p.includes(r.match), text: r.text })),
    );
    setFixtureMode({ asr: fakeAsr, e2e: fakeE2e, llm: fakeLlm });

    // Give React a tick to flush the adapter swap before starting the session.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await session.start(fixture.title);
    setView('meeting');

    if (fixture.qa && fixture.wakeWordAtEventIndex != null) {
      const wakeWordAt = fixture.events[fixture.wakeWordAtEventIndex].atMs / 60;
      setTimeout(() => {
        fakeE2e.scriptTurn({
          question: fixture.qa!.question,
          answer: fixture.qa!.answer,
          audioChunks: [],
        });
      }, wakeWordAt + 500);
    }
  };

  if (!loaded) return null;

  const appStyle: CSSProperties = {
    ['--sidebar-width' as string]: `${sidebarWidth}px`,
  };

  return (
    <div
      className={`app${sidebarWidth === 0 ? ' sidebar-collapsed' : ''}${resizing ? ' resizing' : ''}`}
      style={appStyle}
    >
      <Sidebar
        theme={theme}
        history={history}
        activeMeetingId={view === 'meeting' ? session.meetingId : null}
        selectedId={view === 'past' ? (pastMeeting?.meta.id ?? null) : null}
        onSelect={openPast}
        onStartMeeting={startMeeting}
        onToggleTheme={toggle}
        onOpenSettings={() => setSettingsOpen(true)}
        isMeetingActive={view === 'meeting'}
        status={session.status}
        onResumeClick={session.resume}
      />
      <div
        className="sidebar-resize-handle"
        onMouseDown={startSidebarResize}
        aria-label={sidebarWidth === 0 ? 'Drag to open sidebar' : 'Drag to resize sidebar'}
        title={
          sidebarWidth === 0 ? 'Drag right to open sidebar (⌘B)' : 'Drag to resize sidebar (⌘B)'
        }
        role="separator"
      />
      <div className="main-pane">
        {view === 'idle' && (
          <IdleView
            onStart={startMeeting}
            lastError={session.lastError}
            onOpenMicSettings={() => void invoke('open_mic_settings')}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        {view === 'meeting' && (
          <MeetingView
            title="Current meeting"
            elapsedSec={session.elapsedSec}
            summaries={session.summaries}
            activeSummary={session.activeSummary}
            currentExchange={session.currentExchange}
            liveQa={session.liveQa}
            orbState={session.orbState}
            orbSize={180}
            amplitude={session.amplitude}
            liveText={session.liveText}
            liveSpeaker={session.liveSpeaker}
            lastTranscriptAt={session.lastTranscriptAt}
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
          settings={settings}
          setSettings={setSettings}
          testVolcano={(id, key) => asr.testCredentials(id, key)}
          testLlm={(cfg) => llm.testCredentials(cfg)}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      {exportOpen && pastMeeting && (
        <ExportModal
          meeting={pastMeeting}
          onClose={() => setExportOpen(false)}
          onDownload={downloadMd}
        />
      )}

      {crashModalOpen && crashed.length > 0 && (
        <CrashRecoveryModal
          crashed={crashed}
          onFinalize={async (id) => {
            await finalizeCrashed(id);
            await refreshCrashed();
          }}
          onDiscard={async (id) => {
            await discardCrashed(id);
          }}
          onClose={() => setCrashModalOpen(false)}
        />
      )}

      {endingMeeting && (
        <div className="modal-scrim">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>
                  {endingMeeting.phase === 'generating' ? '正在结束会议' : '结束会议遇到问题'}
                </h3>
              </div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>{endingMeeting.message}</p>
              {endingMeeting.phase === 'generating' && (
                <div className="hint" style={{ marginTop: 8 }}>
                  纪要由 LLM 生成，通常需要 5–15 秒。
                </div>
              )}
            </div>
            {endingMeeting.phase === 'error' && (
              <div className="modal-foot">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    setEndingMeeting(null);
                    await refreshHistory();
                    setView('idle');
                  }}
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <DevTweaks onForceView={(v) => setView(v)} onReplayFixture={replayFixture} />
    </div>
  );
}
