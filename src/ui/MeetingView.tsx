import type { AiExchange, OrbState, Summary } from '../logic/types';
import { Orb } from './Orb';
import { Icon } from './Icon';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { LiveTranscript } from './LiveTranscript';

export interface MeetingViewProps {
  title: string;
  elapsedSec: number;
  summaries: Summary[];
  activeSummary: Summary | null;
  currentExchange: AiExchange | null;
  orbState: OrbState;
  orbSize: number;
  amplitude?: number | null;
  liveText: string;
  liveSpeaker: string | null;
  wakeWord: string;
  onOpenSettings: () => void;
  onEnd: () => void;
}

export function MeetingView(p: MeetingViewProps) {
  const stateLabel = (
    {
      idle: 'Listening',
      activated: 'Activated',
      thinking: 'Thinking',
      speaking: 'Responding',
    } as const
  )[p.orbState];

  return (
    <>
      <div className="main-toolbar">
        <div className="main-toolbar-left">
          <div className="rec-indicator">
            <span className="rec-dot" />
            <span>REC {fmtElapsed(p.elapsedSec)}</span>
          </div>
          <div className="main-meeting-title">{p.title}</div>
        </div>
        <div className="main-toolbar-right">
          <button className="icon-btn" onClick={p.onOpenSettings} aria-label="Settings">
            <Icon name="settings" />
          </button>
          <button className="btn btn-end" onClick={p.onEnd}>
            End meeting
          </button>
        </div>
      </div>

      <main className="main">
        <div className="column">
          {p.summaries.map((s, i) => (
            <SummaryCard key={i} s={s} />
          ))}
          {p.currentExchange && (
            <AiBlock
              question={p.currentExchange.question}
              answer={p.currentExchange.answer}
              cites={p.currentExchange.cites}
              speaking={p.orbState === 'speaking'}
              thinking={p.orbState === 'thinking'}
              timestampLabel={new Date(p.currentExchange.t).toTimeString().slice(0, 8)}
            />
          )}
          {p.activeSummary && <SummaryCard s={p.activeSummary} />}
        </div>
      </main>

      <div className="statusbar">
        <div className="statusbar-inner">
          <div className="orb-with-hint">
            <div className={`status-chip state-${p.orbState}`}>
              <span className="dot" />
              {stateLabel}
            </div>
            <div className="orb-stage">
              <Orb state={p.orbState} size={p.orbSize} amplitude={p.amplitude ?? undefined} />
            </div>
          </div>
          <LiveTranscript displayText={p.liveText} speaker={p.liveSpeaker} state={p.orbState} />
          <div className="orb-hint">
            {p.orbState === 'idle' ? (
              <>
                Say <kbd>{p.wakeWord}</kbd> to ask
              </>
            ) : p.orbState === 'activated' ? (
              <span style={{ color: 'var(--accent)' }}>Listening for question…</span>
            ) : p.orbState === 'thinking' ? (
              <span style={{ color: 'var(--warning)' }}>Generating answer…</span>
            ) : (
              <span style={{ color: 'var(--accent)' }}>Speaking</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
