import type { MeetingMeta } from '../logic/types';
import { Icon } from './Icon';

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
  const {
    theme,
    history,
    activeMeetingId,
    selectedId,
    onSelect,
    onStartMeeting,
    onToggleTheme,
    onOpenSettings,
    isMeetingActive,
  } = props;

  return (
    <aside className="sidebar">
      {/* Native macOS traffic lights overlay this space via titleBarStyle:"Overlay". */}
      <div className="sidebar-traffic" />

      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark" />
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
            <>
              <span className="rec-dot-sm" style={{ marginRight: 2 }} />
              Recording
            </>
          ) : (
            <>
              <Icon name="mic" size={13} /> Start meeting
            </>
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
              {m.id === activeMeetingId ? (
                <span className="history-live-pip" />
              ) : (
                <span className="history-tag">{m.tag}</span>
              )}
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
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <button className="sidebar-foot-btn" onClick={onOpenSettings}>
          <Icon name="settings" size={14} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 · ${d.toTimeString().slice(0, 5)}`;
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
