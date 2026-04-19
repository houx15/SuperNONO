import type { FullMeeting } from '../logic/types';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { Icon } from './Icon';

interface Props {
  meeting: FullMeeting;
  onReExport: () => void;
}

export function PastMeetingView({ meeting, onReExport }: Props) {
  const isEmpty = meeting.summaries.length === 0 && meeting.aiExchanges.length === 0;

  return (
    <>
      <div className="main-toolbar">
        <div className="main-toolbar-left">
          <div className="main-meeting-title">{meeting.meta.title}</div>
        </div>
        <div className="main-toolbar-right">
          <button className="btn btn-primary" onClick={onReExport}>
            <Icon name="download" size={14} /> Re-export
          </button>
        </div>
      </div>
      <main className="main">
        <div className="column">
          {meeting.summaries.map((s, i) => (
            <SummaryCard key={i} s={s} />
          ))}
          {meeting.aiExchanges.map((x, i) => (
            <AiBlock
              key={i}
              question={x.question}
              answer={x.answer}
              cites={x.cites}
              speaking={false}
              thinking={false}
              timestampLabel={new Date(x.t).toTimeString().slice(0, 8)}
            />
          ))}
          {isEmpty && (
            <div
              style={{
                padding: 'var(--s-6)',
                color: 'var(--fg-muted)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              <div style={{ marginBottom: 8, fontWeight: 500 }}>No content captured</div>
              <div style={{ fontSize: 12, color: 'var(--fg-faint)' }}>
                This meeting ended before any summary cards or Q&A exchanges were generated. The
                fixture replay demo runs much faster than the real 5-minute summary interval, so
                summaries don&apos;t get produced during a 10-second replay.
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
