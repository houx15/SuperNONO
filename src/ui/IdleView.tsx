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
            <h4>⚠ 启动会议失败</h4>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-word' }}>
              {lastError}
            </p>
            <p style={{ fontSize: 12 }}>
              常见原因：凭证尚未在 Settings 中保存；网络无法到达 Volcano；麦克风或 AudioWorklet
              加载失败。请先在 Settings 中测试凭证。
            </p>
            {onOpenSettings && <button onClick={onOpenSettings}>打开 Settings</button>}
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
