import { useEffect, useMemo, useState } from 'react';
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
import { DoubaoLlmClient } from './adapters/DoubaoLlmClient';
import { FixtureAsrClient } from './adapters/FixtureAsrClient';
import { fsAdapter } from './adapters/FsAdapter';
import { DevTweaks } from './ui/DevTweaks';
import { FakeE2eClient } from './logic/__fakes__/FakeE2eClient';
import { FakeLlmClient } from './logic/__fakes__/FakeLlmClient';
import { loadAsrFixture, loadDoubaoRules } from './logic/fixtures';
import { Icon } from './ui/Icon';
import type { FullMeeting } from './logic/types';

type View = 'idle' | 'meeting' | 'past';

export default function App() {
  const { theme, toggle } = useTheme();
  const { state: settings, setState: setSettings, save: saveSettings, loaded } = useSettings();
  const { list: history, crashed, refresh: refreshHistory } = useHistory();
  const [crashModalOpen, setCrashModalOpen] = useState(false);

  const [view, setView] = useState<View>('idle');
  const [pastMeeting, setPastMeeting] = useState<FullMeeting | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('supernono.sidebarCollapsed') === 'true',
  );

  useEffect(() => {
    localStorage.setItem('supernono.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [sessionId] = useState(() => 'session_' + Math.random().toString(16).slice(2, 10));
  const [fixtureMode, setFixtureMode] = useState<{
    asr: FixtureAsrClient;
    e2e: FakeE2eClient;
    llm: FakeLlmClient;
  } | null>(null);

  const realAsr = useMemo(() => new VolcanoAsrClient(sessionId), [sessionId]);
  const realE2e = useMemo(() => new DoubaoE2eClient(sessionId), [sessionId]);
  const realLlm = useMemo(
    () => new DoubaoLlmClient(settings.doubaoApiKey),
    [settings.doubaoApiKey],
  );

  const asr = fixtureMode?.asr ?? realAsr;
  const e2e = fixtureMode?.e2e ?? realE2e;
  const llm = fixtureMode?.llm ?? realLlm;

  const session = useMeetingSession({
    asr,
    e2e,
    llm,
    persistence: fsAdapter,
    wakeWord: settings.wakeWord,
    lang: 'zh',
  });

  const startMeeting = async () => {
    try {
      await invoke('prevent_sleep_enable', { reason: 'SuperNono meeting in progress' });
    } catch {
      /* non-Tauri env or plugin missing */
    }
    const title = `Meeting · ${new Date().toLocaleString()}`;
    await session.start(title);
    setView('meeting');
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

  const endMeeting = async () => {
    await session.stop();
    try {
      await invoke('prevent_sleep_disable');
    } catch {
      /* non-Tauri */
    }
    // For M1, opening the export modal after stop needs the saved meeting record.
    // We read it back from disk to populate pastMeeting for the ExportModal.
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCrashModalOpen(crashed.length > 0);
  }, [crashed]);

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

  const discardCrashed = async (_id: string) => {
    // For M1 we don't have a delete-folder Rust command; mark as ended with no minutes.
    // A follow-up task can add `meeting_delete`.
    await refreshHistory();
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

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
      />
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarCollapsed((c) => !c)}
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        title={sidebarCollapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
      >
        <Icon name="panel-left" size={14} />
      </button>
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
          wakeWord={settings.wakeWord}
          setWakeWord={(v) => setSettings({ ...settings, wakeWord: v })}
          volcanoAppId={settings.volcanoAppId}
          setVolcanoAppId={(v) => setSettings({ ...settings, volcanoAppId: v })}
          volcanoAccessKey={settings.volcanoAccessKey}
          setVolcanoAccessKey={(v) => setSettings({ ...settings, volcanoAccessKey: v })}
          doubaoApiKey={settings.doubaoApiKey}
          setDoubaoApiKey={(v) => setSettings({ ...settings, doubaoApiKey: v })}
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
          onDownload={downloadMd}
        />
      )}

      {crashModalOpen && (
        <CrashRecoveryModal
          crashed={crashed}
          onFinalize={async (id) => {
            await finalizeCrashed(id);
            setCrashModalOpen(false);
          }}
          onDiscard={async (id) => {
            await discardCrashed(id);
            setCrashModalOpen(false);
          }}
          onClose={() => setCrashModalOpen(false)}
        />
      )}

      <DevTweaks onForceView={(v) => setView(v)} onReplayFixture={replayFixture} />
    </div>
  );
}
