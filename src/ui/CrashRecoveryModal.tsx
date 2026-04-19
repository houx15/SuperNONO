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
            <div className="sub">SuperNono didn&apos;t finish these last time.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          {crashed.map((m) => (
            <div
              key={m.id}
              className="form-row"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <strong>{m.title}</strong>
                <div className="hint">Started {new Date(m.started_at).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => void onFinalize(m.id)}>
                  Finalize
                </button>
                <button className="btn btn-ghost" onClick={() => void onDiscard(m.id)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
