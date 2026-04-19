import { Icon } from './Icon';
import type { FullMeeting } from '../logic/types';

interface Props {
  meeting: FullMeeting;
  onClose: () => void;
  onDownload: () => Promise<void>;
}

export function ExportModal({ meeting, onClose, onDownload }: Props) {
  const { meta, summaries, minutesMd } = meeting;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Export meeting notes</h3>
            <div className="sub">Markdown · ready to download</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="doc-preview">
            <dl className="meta-grid">
              <dt>Title</dt>
              <dd>{meta.title}</dd>
              <dt>Duration</dt>
              <dd>{fmtDur(meta.duration_sec ?? 0)}</dd>
              <dt>Speakers</dt>
              <dd>{meta.speaker_count}</dd>
            </dl>
            <h2>Agenda · 议程</h2>
            <ul>
              {summaries.map((s, i) => (
                <li key={i}>{s.topic}</li>
              ))}
            </ul>
            <h2>Preview</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>
              {minutesMd ?? '(generating…)'}
            </pre>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onDownload}>
            <Icon name="download" size={14} /> Download .md
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
