// Meeting.jsx — summary cards, AI Q&A block, live transcript, settings/export modals
// Technical-product aesthetic (Stripe/Raycast-inspired)

function Icon({ name, size = 16 }) {
  const stroke = 'currentColor';
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'settings': return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    );
    case 'download': return (
      <svg {...common}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    );
    case 'close': return (
      <svg {...common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    );
    case 'mic': return (
      <svg {...common}>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
      </svg>
    );
    case 'speaker': return (
      <svg {...common}>
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
    );
    case 'key': return (
      <svg {...common}>
        <circle cx="7" cy="14" r="4"/>
        <path d="M10 11l11-7"/><path d="M16 7l3 3"/>
      </svg>
    );
    case 'globe': return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    );
    case 'sparkle': return (
      <svg {...common}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/></svg>
    );
    case 'moon': return (
      <svg {...common}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    );
    case 'sun': return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    );
    case 'check': return (
      <svg {...common}><polyline points="20 6 9 17 4 12"/></svg>
    );
    case 'link': return (
      <svg {...common}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
    );
    case 'clock': return (
      <svg {...common}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    );
    default: return null;
  }
}

/* ---------- Summary card ---------- */
function SummaryCard({ s }) {
  const isBuilding = s.state === 'active';
  return (
    <article className={`summary-card ${isBuilding ? 'building' : ''}`}>
      <div className="summary-time">{s.time}</div>
      <div className="summary-body">
        {isBuilding && (
          <div className="building-meta">Summarizing · 实时总结中</div>
        )}
        <h3>{s.topic}</h3>
        <p>{s.text}</p>
        {s.speakers && (
          <div className="summary-chips">
            {s.speakers.map((sp, i) => (
              <span key={i} className="chip speaker">{sp}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/* ---------- AI Q&A block ---------- */
function AiBlock({ question, answer, cites, speaking, thinking }) {
  return (
    <div className="ai-block">
      <div className="ai-rail">
        <div className="ai-tag">SuperNono</div>
        <div className="ai-time">14:12:03</div>
      </div>
      <div className="ai-body">
        <div className="ai-qa">
          <span className="ai-q-label">Captured question</span>
          <p className="ai-q-text">{question}</p>
        </div>

        {thinking ? (
          <ThinkingState/>
        ) : (
          <>
            <p className="ai-answer" dangerouslySetInnerHTML={{ __html: answer }}/>
            {cites && cites.length > 0 && (
              <div className="ai-sources">
                {cites.map((c, i) => (
                  <a key={i} className="ai-source" href="#" onClick={e=>e.preventDefault()}>
                    <span className="dot"/> {c}
                  </a>
                ))}
              </div>
            )}
            <div className="ai-meta-row">
              <span className="meta-item"><Icon name="sparkle" size={10}/> Doubao 1.5 · pro</span>
              <span className="meta-item"><Icon name="clock" size={10}/> 1.8s</span>
              <span className="meta-item">·&nbsp; 247 tokens</span>
              {speaking && <span className="meta-item" style={{color:'var(--accent)', marginLeft:'auto'}}>🔊 Speaking</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ThinkingState() {
  const [dots, setDots] = React.useState(1);
  React.useEffect(() => {
    const i = setInterval(() => setDots(d => (d % 3) + 1), 400);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="ai-answer" style={{
      display:'flex', alignItems:'center', gap: 10,
      color: 'var(--fg-muted)', fontFamily: 'var(--mono)', fontSize: 13,
    }}>
      <span style={{display:'inline-flex', gap:3}}>
        {[0,1,2].map(i => (
          <span key={i} style={{
            width:6, height:6, borderRadius:'50%',
            background:'var(--warning)',
            opacity: dots > i ? 1 : 0.22,
            transition: 'opacity 0.2s',
          }}/>
        ))}
      </span>
      Querying knowledge base · retrieving competitor pricing from Notion, web & internal notes
    </div>
  );
}

/* ---------- Live transcript ---------- */
function LiveTranscript({ lines, state, wakeWord }) {
  const [idx, setIdx] = React.useState(0);
  const [charIdx, setCharIdx] = React.useState(0);

  const currentLine = lines[idx % lines.length];
  const fullText = currentLine.text;

  React.useEffect(() => {
    if (state === 'activated' || state === 'thinking' || state === 'speaking') return;
    if (charIdx < fullText.length) {
      const t = setTimeout(() => setCharIdx(charIdx + 1), 55 + Math.random() * 50);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => { setIdx(idx + 1); setCharIdx(0); }, 2400);
      return () => clearTimeout(t);
    }
  }, [charIdx, idx, fullText, state]);

  const rawDisplayText = state === 'activated'
    ? '东南亚主要 SaaS 竞品在新加坡的定价区间是多少？'
    : state === 'thinking'
    ? '…'
    : state === 'speaking'
    ? ''
    : fullText.slice(0, charIdx);

  const TAIL_LEN = 22;
  const isTailing = rawDisplayText.length > TAIL_LEN;
  const displayText = isTailing ? rawDisplayText.slice(-TAIL_LEN) : rawDisplayText;

  const displaySpeaker = (state === 'activated' || state === 'thinking' || state === 'speaking')
    ? null : currentLine.speaker;

  const label = {
    listening: 'Live transcript',
    activated: 'Captured input',
    thinking:  'Processing',
    speaking:  'Speaking',
  }[state];

  return (
    <div className="live-transcript">
      <div className="live-label">
        <span className="pip" />
        {label}
      </div>
      <div className="live-text">
        <span className="transcript-scroll">
          <span className="transcript-inner">
            {displaySpeaker && <span className="speaker-tag">{displaySpeaker}</span>}
            {isTailing && <span className="transcript-prefix">… </span>}
            <span>{displayText}</span>
            {state !== 'speaking' && <span className="cursor-bar" />}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------- Settings modal ---------- */
function SettingsModal({ onClose, wakeWord, setWakeWord }) {
  const [level, setLevel] = React.useState(45);
  React.useEffect(() => {
    const i = setInterval(() => {
      setLevel(20 + Math.random() * 70);
    }, 100);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Settings</h3>
            <div className="sub">Configure · v0.9.2</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Microphone · 麦克风</label>
            <div className="select-row">
              <select className="input" defaultValue="macbook">
                <option value="macbook">MacBook Pro 麦克风 (内置)</option>
                <option value="krisp">Krisp Microphone</option>
                <option value="airpods">AirPods Pro · Aurora's</option>
              </select>
              <button className="btn btn-ghost" style={{height:32}}>Test</button>
            </div>
            <div className="level-meter">
              <div className="level-meter-fill" style={{width: `${level}%`}}/>
            </div>
            <div className="hint">Input level · ambient ~{Math.round(level)}%</div>
          </div>

          <div className="form-row">
            <label>Speaker · 扬声器</label>
            <div className="select-row">
              <select className="input" defaultValue="macbook">
                <option value="macbook">MacBook Pro 扬声器 (内置)</option>
                <option value="airpods">AirPods Pro</option>
                <option value="studio">Studio Display 扬声器</option>
              </select>
              <button className="btn btn-ghost" style={{height:32}}>Play</button>
            </div>
          </div>

          <div className="form-row">
            <label>Wake word · 唤醒词</label>
            <input
              className="input"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              placeholder="e.g. Hey Nono"
            />
            <div className="hint">Phrase triggers Q&A mode mid-conversation. Choose something natural but unlikely to mis-trigger.</div>
          </div>

          <div className="form-row">
            <label>Doubao API key</label>
            <input
              className="input mono"
              type="password"
              defaultValue="sk-ark-••••••••••••••••••••c4f2"
            />
            <div className="hint">Stored locally in <code style={{fontFamily:'var(--mono)', fontSize:10}}>localStorage</code>. Never sent to our servers.</div>
          </div>

          <div className="form-row">
            <label>Primary language · 主要语言</label>
            <select className="input" defaultValue="zh">
              <option value="zh">中文 (Chinese)</option>
              <option value="en">English</option>
              <option value="auto">Auto-detect</option>
            </select>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}>
            <Icon name="check" size={14}/> Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Export modal ---------- */
function ExportModal({ onClose, data }) {
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
              <dt>Title</dt>         <dd>{data.title}</dd>
              <dt>Date</dt>          <dd>{data.date || '2025-03-18'}</dd>
              <dt>Duration</dt>      <dd>{data.duration || '00:42:18'}</dd>
              <dt>Attendees</dt>     <dd>{data.attendees || '4'}</dd>
              <dt>Transcript</dt>    <dd>{data.wordcount || '1,842 字'}</dd>
            </dl>

            <h2>Agenda · 议程</h2>
            <ul>{data.agenda.map((a, i) => <li key={i}>{a}</li>)}</ul>

            <h2>Key decisions · 关键决策</h2>
            <ul>{data.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>

            <h2>Action items · 行动项</h2>
            <ul>
              {data.actions.map((a, i) => (
                <li key={i}>
                  <strong style={{color:'var(--accent)', fontFamily:'var(--mono)', fontSize:11}}>[{a.tag}]</strong>
                  {' '}<strong style={{color:'var(--fg)'}}>{a.owner}</strong> — {a.task}
                </li>
              ))}
            </ul>

            <h2>Full transcript · 完整转写</h2>
            <p style={{color:'var(--fg-dim)', fontSize: 12, fontFamily:'var(--mono)'}}>
              Appendix · 1,842-character verbatim record (collapsed)
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">
            <Icon name="download" size={14}/> Download .md
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  Icon, SummaryCard, AiBlock, LiveTranscript, SettingsModal, ExportModal,
});
