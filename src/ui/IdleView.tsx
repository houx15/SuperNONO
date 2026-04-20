import { Orb } from './Orb';
import { Icon } from './Icon';

interface Props {
  onStart: () => void;
  lastError?: string | null;
  onOpenMicSettings?: () => void;
  onOpenSettings?: () => void;
}

export function IdleView({ onStart, lastError, onOpenMicSettings, onOpenSettings }: Props) {
  const isMicDenied = lastError === 'mic_denied';
  const hasGenericError = lastError && lastError !== 'mic_denied' && lastError !== 'other';
  return (
    <div className="idle-view">
      <div className="idle-inner">
        <div className="idle-orb-stage">
          <Orb state="idle" size={220} />
        </div>
        <div className="idle-heading">No meeting in progress</div>
        <div className="idle-sub">
          Start a session and SuperNono will listen, summarize and answer questions on demand.
        </div>
        {isMicDenied && (
          <div className="mic-help">
            <h4>Microphone access denied</h4>
            <p>
              SuperNono needs your microphone to hear the meeting. Grant access in system settings,
              then retry.
            </p>
            <button onClick={onOpenMicSettings}>Open system settings</button>
          </div>
        )}
        {hasGenericError && (
          <div className="mic-help" style={{ borderColor: 'var(--warning)' }}>
            <h4 style={{ color: 'var(--warning)' }}>⚠ 启动会议失败</h4>
            <pre
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg-subtle)',
                padding: '8px 10px',
                borderRadius: 4,
                margin: '6px 0',
                border: '1px solid var(--border)',
              }}
            >
              {lastError}
            </pre>
            {onOpenSettings && (
              <button onClick={onOpenSettings} style={{ marginTop: 4 }}>
                打开 Settings
              </button>
            )}
          </div>
        )}
        <button className="btn btn-primary btn-start" onClick={onStart}>
          <Icon name="mic" size={14} /> Start meeting
        </button>
        <div className="idle-shortcuts">
          <span>
            <kbd>⌘</kbd>
            <kbd>⇧</kbd>
            <kbd>N</kbd> Start
          </span>
          <span className="sep">·</span>
          <span>
            Say <kbd>嘿 Nono</kbd> to ask
          </span>
        </div>
      </div>
    </div>
  );
}
