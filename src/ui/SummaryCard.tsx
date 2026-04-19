import type { Summary } from '../logic/types';

export function SummaryCard({ s }: { s: Summary }) {
  const isBuilding = s.state === 'active';
  return (
    <article className={`summary-card ${isBuilding ? 'building' : ''}`}>
      <div className="summary-time">{s.time}</div>
      <div className="summary-body">
        {isBuilding && <div className="building-meta">Summarizing · 实时总结中</div>}
        <h3>{s.topic}</h3>
        <p>{s.text}</p>
        {s.speakers && (
          <div className="summary-chips">
            {s.speakers.map((sp, i) => (
              <span key={i} className="chip speaker">
                {sp}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
