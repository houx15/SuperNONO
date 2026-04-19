import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  question: string;
  answer: string;
  cites: string[] | null;
  speaking: boolean;
  thinking: boolean;
  timestampLabel?: string;
}

export function AiBlock({
  question,
  answer,
  cites,
  speaking,
  thinking,
  timestampLabel = '',
}: Props) {
  return (
    <div className="ai-block">
      <div className="ai-rail">
        <div className="ai-tag">SuperNono</div>
        <div className="ai-time">{timestampLabel}</div>
      </div>
      <div className="ai-body">
        <div className="ai-qa">
          <span className="ai-q-label">Captured question</span>
          <p className="ai-q-text">{question}</p>
        </div>
        {thinking ? (
          <ThinkingState />
        ) : (
          <>
            <p className="ai-answer" dangerouslySetInnerHTML={{ __html: answer }} />
            {cites && cites.length > 0 && (
              <div className="ai-sources">
                {cites.map((c, i) => (
                  <a key={i} className="ai-source" href="#" onClick={(e) => e.preventDefault()}>
                    <span className="dot" /> {c}
                  </a>
                ))}
              </div>
            )}
            <div className="ai-meta-row">
              <span className="meta-item">
                <Icon name="sparkle" size={10} /> Doubao E2E · realtime
              </span>
              {speaking && (
                <span className="meta-item" style={{ color: 'var(--accent)', marginLeft: 'auto' }}>
                  🔊 Speaking
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ThinkingState() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(i);
  }, []);
  return (
    <div
      className="ai-answer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--fg-muted)',
        fontFamily: 'var(--mono)',
        fontSize: 13,
      }}
    >
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--warning)',
              opacity: dots > i ? 1 : 0.22,
              transition: 'opacity 0.2s',
            }}
          />
        ))}
      </span>
      Generating answer…
    </div>
  );
}
