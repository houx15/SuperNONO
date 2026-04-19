import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
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

  const [sessionId] = useState(() => 'session_' + Math.random().toString(16).slice(2, 10));
  const asr = useMemo(() => new VolcanoAsrClient(sessionId), [sessionId]);
  const e2e = useMemo(() => new DoubaoE2eClient(sessionId), [sessionId]);
  const llm = useMemo(() => new DoubaoLlmClient(settings.doubaoApiKey), [settings.doubaoApiKey]);

  const session = useMeetingSession({
    asr,
    e2e,
    llm,
    persistence: fsAdapter,
    wakeWord: settings.wakeWord,
    lang: 'zh',
  });

  const startMeeting = async () => {
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
        selectedId={view === 'past' ? (pastMeeting?.meta.id ?? null) : null}
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
          onDownload={async () => {
            /* wired in Task 59 */
          }}
        />
      )}
    </div>
  );
}
