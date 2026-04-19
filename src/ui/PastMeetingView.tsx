import type { FullMeeting } from '../logic/types';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { Icon } from './Icon';

interface Props {
  meeting: FullMeeting;
  onReExport: () => void;
}

export function PastMeetingView({ meeting, onReExport }: Props) {
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
        </div>
      </main>
    </>
  );
}
