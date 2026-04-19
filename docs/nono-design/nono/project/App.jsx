// App.jsx — SuperNono desktop (Tauri-style macOS window, sidebar + main)

const { useState, useEffect } = React;

const TWEAKS_DEFAULTS = /*EDITMODE-BEGIN*/{
  "meetingState": "listening",
  "theme": "light",
  "showSpeakers": true,
  "orbSize": 180,
  "view": "meeting",
  "sidebarOpen": true
}/*EDITMODE-END*/;

/* ---------- Sidebar (meeting history) ---------- */
function Sidebar({ tweaks, setTweaks, onNewMeeting }) {
  const history = window.MEETING_HISTORY;
  const [selectedId, setSelectedId] = useState(history[0].id);

  const isMeetingView = tweaks.view === 'meeting';

  return (
    <aside className="sidebar">
      {/* Traffic lights at top-left of window */}
      <div className="sidebar-traffic">
        <TrafficLights theme={tweaks.theme}/>
      </div>

      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"/>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">SuperNono</div>
            <div className="sidebar-brand-ver">v0.9.2 · desktop</div>
          </div>
        </div>

        <button
          className={`btn ${isMeetingView ? 'btn-recording' : 'btn-primary'} btn-new`}
          onClick={onNewMeeting}
          disabled={isMeetingView}
        >
          {isMeetingView ? (
            <>
              <span className="rec-dot-sm" style={{marginRight: 2}}/>
              Recording · Q2 strategy
            </>
          ) : (
            <>
              <Icon name="mic" size={13}/>
              Start meeting
            </>
          )}
        </button>
      </div>

      {/* Current meeting indicator removed — covered by Recording button + active history item */}

      {/* History */}
      <div className="sidebar-section-label">
        <span>History</span>
        <span className="sidebar-count">{history.length}</span>
      </div>
      <div className="sidebar-history">
        {history.map((m) => (
          <button
            key={m.id}
            className={`history-item ${selectedId === m.id ? 'selected' : ''} ${m.active && isMeetingView ? 'active-rec' : ''}`}
            onClick={() => setSelectedId(m.id)}
          >
            <div className="history-item-row">
              <span className="history-title">{m.title}</span>
              {m.active && isMeetingView
                ? <span className="history-live-pip"/>
                : <span className="history-tag">{m.tag}</span>}
            </div>
            <div className="history-meta">
              <span className="history-date">{m.date}</span>
              <span className="history-dot">·</span>
              <span className="history-dur">{m.duration}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer — settings + theme */}
      <div className="sidebar-foot">
        <button
          className="sidebar-foot-btn"
          onClick={() => {
            const next = tweaks.theme === 'light' ? 'dark' : 'light';
            setTweaks({ ...tweaks, theme: next });
            window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { theme: next } }, '*');
          }}
        >
          <Icon name={tweaks.theme === 'dark' ? 'sun' : 'moon'} size={14}/>
          <span>{tweaks.theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <button className="sidebar-foot-btn">
          <Icon name="settings" size={14}/>
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

/* ---------- Idle state (no meeting) ---------- */
function IdleView({ onStart, theme }) {
  return (
    <div className="idle-view">
      <div className="idle-inner">
        <div className="idle-orb-stage">
          <Orb state="idle" size={220}/>
        </div>
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

/* ---------- Meeting view (summary cards + status bar) ---------- */
function MeetingView({ tweaks, setTweaks, onEnd }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [wakeWord, setWakeWord] = useState('嘿 Nono');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const data = window.MEETING_DATA;
  const state = tweaks.meetingState;
  const orbState = state === 'listening' ? 'idle' : state;
  const showAiBlock = state === 'speaking' || state === 'thinking';

  const fmtElapsed = () => {
    const total = elapsed + 1392;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const stateLabel = {
    listening: 'Listening',
    activated: 'Activated',
    thinking:  'Thinking',
    speaking:  'Responding',
  }[state];

  return (
    <>
      {/* Secondary toolbar (inside main pane) */}
      <div className="main-toolbar">
        <div className="main-toolbar-left">
          <div className="rec-indicator">
            <span className="rec-dot" />
            <span>REC {fmtElapsed()}</span>
          </div>
          <div className="main-meeting-title">Q2 strategy review</div>
        </div>
        <div className="main-toolbar-right">
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Icon name="settings" />
          </button>
          <button className="btn btn-end" onClick={() => setExportOpen(true)}>
            End meeting
          </button>
        </div>
      </div>

      <main className="main">
        <div className="column">
          {data.summaries.map((s, i) => (
            <SummaryCard
              key={i}
              s={tweaks.showSpeakers ? s : { ...s, speakers: null }}
            />
          ))}

          {showAiBlock && (
            <AiBlock
              question={data.aiExchange.question}
              answer={state === 'thinking' ? '' : data.aiExchange.answer}
              cites={state === 'speaking' ? data.aiExchange.cites : null}
              speaking={state === 'speaking'}
              thinking={state === 'thinking'}
            />
          )}

          <SummaryCard
            s={tweaks.showSpeakers ? data.activeSummary : { ...data.activeSummary, speakers: null }}
          />
        </div>
      </main>

      <div className="statusbar">
        <div className="statusbar-inner">
          <div className="orb-with-hint">
            <div className={`status-chip state-${state}`}>
              <span className="dot"/> {stateLabel}
            </div>
            <div className="orb-stage">
              <Orb state={orbState} size={tweaks.orbSize} />
            </div>
          </div>

          <LiveTranscript lines={data.liveLines} state={state} wakeWord={wakeWord}/>

          <div className="orb-hint">
            {state === 'listening' ? (
              <>Say <kbd>嘿 Nono</kbd> to ask</>
            ) : state === 'activated' ? (
              <span style={{color: 'var(--accent)'}}>Listening for question…</span>
            ) : state === 'thinking' ? (
              <span style={{color: 'var(--warning)'}}>Generating answer…</span>
            ) : (
              <span style={{color: 'var(--accent)'}}>Speaking</span>
            )}
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          wakeWord={wakeWord}
          setWakeWord={setWakeWord}
        />
      )}
      {exportOpen && (
        <ExportModal
          onClose={() => setExportOpen(false)}
          data={data.export}
        />
      )}
    </>
  );
}

/* ---------- Main app ---------- */
function SuperNonoApp({ tweaks, setTweaks }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
  }, [tweaks.theme]);

  const setView = (v) => {
    setTweaks({ ...tweaks, view: v });
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { view: v } }, '*');
  };

  return (
    <div className="app">
      <Sidebar
        tweaks={tweaks}
        setTweaks={setTweaks}
        onNewMeeting={() => setView('meeting')}
      />
      <div className="main-pane">
        {tweaks.view === 'meeting' ? (
          <MeetingView tweaks={tweaks} setTweaks={setTweaks} onEnd={() => setView('idle')}/>
        ) : (
          <IdleView onStart={() => setView('meeting')} theme={tweaks.theme}/>
        )}
      </div>
      <TweaksPanel tweaks={tweaks} setTweaks={setTweaks}/>
    </div>
  );
}

/* ---------- Tweaks Panel ---------- */
function TweaksPanel({ tweaks, setTweaks }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') setVisible(true);
      if (d.type === '__deactivate_edit_mode') setVisible(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
  };

  if (!visible) return null;

  const states = [
    ['listening', 'Listening'],
    ['activated', 'Activated'],
    ['thinking', 'Thinking'],
    ['speaking', 'Speaking'],
  ];

  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <div className="tweaks-title">Tweaks</div>
        <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-dim)', letterSpacing:'0.06em'}}>
          DEV
        </div>
      </div>
      <div className="tweaks-body">
        <div className="tweak-group">
          <div className="tweak-label">View</div>
          <div className="tweak-opts">
            <button
              className={`tweak-opt ${tweaks.view === 'idle' ? 'active' : ''}`}
              onClick={() => update({ view: 'idle' })}
            >Idle</button>
            <button
              className={`tweak-opt ${tweaks.view === 'meeting' ? 'active' : ''}`}
              onClick={() => update({ view: 'meeting' })}
            >In meeting</button>
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-label">Theme</div>
          <div className="tweak-opts">
            <button
              className={`tweak-opt ${tweaks.theme === 'light' ? 'active' : ''}`}
              onClick={() => update({ theme: 'light' })}
            >Light</button>
            <button
              className={`tweak-opt ${tweaks.theme === 'dark' ? 'active' : ''}`}
              onClick={() => update({ theme: 'dark' })}
            >Dark</button>
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-label">Meeting State</div>
          <div className="tweak-opts" style={{flexDirection:'column', alignItems:'stretch'}}>
            <div style={{display:'flex', gap:4}}>
              {states.slice(0,2).map(([k, label]) => (
                <button
                  key={k}
                  className={`tweak-opt ${tweaks.meetingState === k ? 'active' : ''}`}
                  onClick={() => update({ meetingState: k })}
                >{label}</button>
              ))}
            </div>
            <div style={{display:'flex', gap:4, marginTop:4}}>
              {states.slice(2).map(([k, label]) => (
                <button
                  key={k}
                  className={`tweak-opt ${tweaks.meetingState === k ? 'active' : ''}`}
                  onClick={() => update({ meetingState: k })}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-label">Speaker Attribution</div>
          <div className="tweak-opts">
            <button
              className={`tweak-opt ${tweaks.showSpeakers ? 'active' : ''}`}
              onClick={() => update({ showSpeakers: true })}
            >On</button>
            <button
              className={`tweak-opt ${!tweaks.showSpeakers ? 'active' : ''}`}
              onClick={() => update({ showSpeakers: false })}
            >Off</button>
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-label">Orb Size</div>
          <div className="tweak-opts">
            {[140, 180, 240].map((s) => (
              <button
                key={s}
                className={`tweak-opt ${tweaks.orbSize === s ? 'active' : ''}`}
                onClick={() => update({ orbSize: s })}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Root ---------- */
function Root() {
  const [tweaks, setTweaks] = useState(TWEAKS_DEFAULTS);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onR = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
  }, [tweaks.theme]);

  const ww = Math.min(dims.w - 40, 1180);
  const wh = Math.min(dims.h - 40, 780);

  // Desktop wallpaper (soft gradient, theme-aware)
  const wallpaper = tweaks.theme === 'dark'
    ? 'radial-gradient(120% 90% at 30% 0%, #1a1c2e 0%, #0b0d15 60%, #050608 100%)'
    : 'radial-gradient(120% 90% at 30% 0%, #e3e6ec 0%, #c8ccd6 60%, #a9afbe 100%)';

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: wallpaper,
      padding: 20,
    }}>
      <DesktopWindow width={ww} height={wh} theme={tweaks.theme}>
        <SuperNonoApp tweaks={tweaks} setTweaks={setTweaks} />
      </DesktopWindow>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
