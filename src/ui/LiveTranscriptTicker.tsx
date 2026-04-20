import { useEffect, useState } from 'react';
import type { OrbState } from '../logic/types';

interface Props {
  text: string;
  speaker: string | null;
  lastTranscriptAt: number | null;
  elapsedSec: number;
  state: OrbState;
}

/**
 * Live transcript ticker: shows the sentence currently being spoken, with
 * fade-out gradients on both horizontal edges so it visually suggests a
 * longer transcript continues out of frame. No scrollable history — the
 * full transcript is persisted to disk and surfaced on end-meeting.
 *
 * Also carries a "stuck" hint: if no final has arrived for >= 15 s, shows
 * a yellow warning so the user knows the pipeline stalled instead of
 * wondering.
 */
export function LiveTranscriptTicker({
  text,
  speaker,
  lastTranscriptAt,
  elapsedSec,
  state,
}: Props) {
  // Recompute "Ns ago" once per second without reading Date.now() during render.
  const [quietFor, setQuietFor] = useState(0);
  useEffect(() => {
    const recompute = () => {
      setQuietFor(
        lastTranscriptAt == null ? elapsedSec : Math.floor((Date.now() - lastTranscriptAt) / 1000),
      );
    };
    recompute();
    const id = window.setInterval(recompute, 1000);
    return () => window.clearInterval(id);
  }, [lastTranscriptAt, elapsedSec]);

  const hasAnything = text.length > 0 || lastTranscriptAt != null;
  const stale = hasAnything && quietFor >= 15;

  const label =
    state === 'idle'
      ? '实时转写'
      : state === 'activated'
        ? '收录问题中'
        : state === 'thinking'
          ? '思考中'
          : '回答中';

  return (
    <section className="live-ticker">
      <header className="live-ticker-head">
        <span className={`live-ticker-dot ${stale ? 'stale' : ''}`} />
        <span className="live-ticker-label">{label}</span>
        {speaker && <span className="live-ticker-speaker">{speaker}</span>}
        <span className={`live-ticker-freshness ${stale ? 'stale' : ''}`}>
          {!hasAnything
            ? elapsedSec < 5
              ? '建立连接…'
              : `等待首句 · ${elapsedSec}s`
            : stale
              ? `⚠ 已 ${quietFor}s 无新转写`
              : `${quietFor}s ago`}
        </span>
      </header>
      <div className="live-ticker-window">
        <div className="live-ticker-fade-left" />
        <div className="live-ticker-text">
          {text ? (
            <span>{text}</span>
          ) : (
            <span className="live-ticker-placeholder">开始说话后，这里会逐字显示当前这句话。</span>
          )}
          {state !== 'speaking' && text && <span className="live-ticker-cursor" />}
        </div>
        <div className="live-ticker-fade-right" />
      </div>
    </section>
  );
}
