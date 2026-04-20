import { useEffect, useRef, useState } from 'react';
import type { Utterance } from '../logic/types';

interface Props {
  transcript: Utterance[];
  lastTranscriptAt: number | null;
  /** Elapsed seconds since meeting start — used as a "nothing yet" hint. */
  elapsedSec: number;
}

/**
 * Running feed of finalized ASR utterances. Shown at the top of the main
 * column so the user gets continuous feedback from the first sentence,
 * long before the 5-min summary can fire.
 *
 * Renders "N seconds since last utterance" when the stream goes quiet —
 * this surfaces the "stuck" class of bug (silent WS close, mic blocked)
 * directly in the UI instead of letting the user wonder.
 */
export function LiveTranscriptPanel({ transcript, lastTranscriptAt, elapsedSec }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Autoscroll to bottom when a new utterance arrives.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript.length]);

  // Recompute "seconds since last utterance" every second without reading
  // Date.now() during render (keeps the component pure).
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

  const hasAny = transcript.length > 0;
  const stale = hasAny && quietFor >= 15;

  return (
    <section className="live-transcript-panel">
      <header className="live-transcript-panel-head">
        <span className="dot-live" />
        <span>实时转写 · Live transcript</span>
        <span className="live-transcript-count">{transcript.length}</span>
        <span className={`live-transcript-status ${stale ? 'stale' : ''}`}>
          {!hasAny
            ? elapsedSec < 5
              ? '正在建立连接…'
              : `等待第一句话 · ${elapsedSec}s`
            : stale
              ? `⚠ 已 ${quietFor}s 没有新转写`
              : `${quietFor}s ago`}
        </span>
      </header>
      <div className="live-transcript-panel-body" ref={scrollRef}>
        {!hasAny && (
          <div className="live-transcript-empty">
            {elapsedSec < 3
              ? '准备中…'
              : '开始说话后，转写会逐句出现在这里。首条摘要将在约 1 分钟后生成。'}
          </div>
        )}
        {transcript.map((u, i) => (
          <div className="live-transcript-line" key={i}>
            <span className="live-transcript-speaker">{u.speaker || 'Speaker'}</span>
            <span className="live-transcript-time">{fmtTime(u.t)}</span>
            <span className="live-transcript-text">{u.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function fmtTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toTimeString().slice(0, 8);
}
