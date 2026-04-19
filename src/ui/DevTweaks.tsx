import { useEffect, useState } from 'react';

interface Props {
  onForceView: (v: 'idle' | 'meeting') => void;
  onReplayFixture: () => Promise<void>;
}

export function DevTweaks(p: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <div className="tweaks-title">Tweaks · DEV</div>
      </div>
      <div className="tweaks-body">
        <div className="tweak-group">
          <div className="tweak-label">View</div>
          <div className="tweak-opts">
            <button className="tweak-opt" onClick={() => p.onForceView('idle')}>
              Idle
            </button>
            <button className="tweak-opt" onClick={() => p.onForceView('meeting')}>
              In meeting
            </button>
          </div>
        </div>
        <div className="tweak-group">
          <div className="tweak-label">Fixture</div>
          <div className="tweak-opts">
            <button className="tweak-opt" onClick={() => void p.onReplayFixture()}>
              Replay Q2 strategy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
