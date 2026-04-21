import type { AiExchange, OrbState, Summary } from '../logic/types';
import { Orb } from './Orb';
import { Icon } from './Icon';
import { SummaryCard } from './SummaryCard';
import { AiBlock } from './AiBlock';
import { LiveTranscriptTicker } from './LiveTranscriptTicker';

export interface MeetingViewProps {
  title: string;
  elapsedSec: number;
  summaries: Summary[];
  activeSummary: Summary | null;
  currentExchange: AiExchange | null;
  /** Partial question + answer while a Q&A turn is active. Both
   *  strings empty means no active turn (UI should hide the live
   *  panel). The completed exchange still flows through
   *  `currentExchange` after turn_end. */
  liveQa: { question: string; answer: string };
  orbState: OrbState;
  orbSize: number;
  amplitude?: number | null;
  liveText: string;
  liveSpeaker: string | null;
  lastTranscriptAt: number | null;
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
          <LiveTranscriptTicker
            text={p.liveText}
            speaker={p.liveSpeaker}
            lastTranscriptAt={p.lastTranscriptAt}
            elapsedSec={p.elapsedSec}
            state={p.orbState}
          />
          {p.summaries.map((s, i) => (
            <SummaryCard key={i} s={s} />
          ))}
          {/* During a Q&A turn we render the LIVE panel instead of the
              completed-exchange card — otherwise the user stares at a
              silent orb for 5-10 s while Nono's answer streams in.
              Once turn_end fires and the session exits, liveQa is
              cleared and currentExchange shows the final pair. */}
          {(p.liveQa.question || p.liveQa.answer || p.orbState !== 'idle') &&
          p.orbState !== 'idle' ? (
            <AiBlock
              question={p.liveQa.question || '（倾听中…）'}
              answer={p.liveQa.answer}
              cites={null}
              speaking={p.orbState === 'speaking'}
              thinking={p.orbState === 'thinking' && !p.liveQa.answer}
              timestampLabel="live"
            />
          ) : (
            p.currentExchange && (
              <AiBlock
                question={p.currentExchange.question}
                answer={p.currentExchange.answer}
                cites={p.currentExchange.cites}
                speaking={false}
                thinking={false}
                timestampLabel={new Date(p.currentExchange.t).toTimeString().slice(0, 8)}
              />
            )
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
