import { Orb } from './Orb';
import { Icon } from './Icon';

interface Props {
  onStart: () => void;
  lastError?: 'mic_denied' | 'other' | null;
  onOpenMicSettings?: () => void;
}

export function IdleView({ onStart, lastError, onOpenMicSettings }: Props) {
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
        {lastError === 'mic_denied' && (
          <div className="mic-help">
            <h4>Microphone access denied</h4>
            <p>
              SuperNono needs your microphone to hear the meeting. Grant access in system settings,
              then retry.
            </p>
            <button onClick={onOpenMicSettings}>Open system settings</button>
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
