// Orb.jsx — waveform / audio-meter orb with a technical aesthetic.
// Built as a series of vertical bars driven by simulated audio amplitude.
// Each state gives a different pattern:
//   'idle'      — low, gently undulating bars (ambient pickup)
//   'activated' — sharp symmetrical spike (wake-word recognized)
//   'thinking'  — traveling shimmer pulse
//   'speaking'  — rhythmic articulation wave (AI voice output)

function Orb({ state = 'idle', size = 170, variant = 'line' }) {
  // All variants collapse to the waveform; keep prop for compat.
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    let raf, start = performance.now();
    const tick = (n) => { setT((n - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <WaveformOrb state={state} size={size} t={t}/>;
}

/* -----------------------------------------------------------------
   Waveform / audio-meter
   32 bars, center-mirrored amplitude, signature per state.
   ----------------------------------------------------------------- */

const BAR_COUNT = 32;

function computeAmps(state, t) {
  const amps = new Array(BAR_COUNT);

  for (let i = 0; i < BAR_COUNT; i++) {
    // Distance from center (0 at edges, 1 at middle)
    const center = (BAR_COUNT - 1) / 2;
    const fromCenter = Math.abs(i - center) / center;     // 0..1
    const envelope = 1 - fromCenter;                       // 1 at center, 0 at edges

    let a;
    switch (state) {
      case 'activated': {
        // Sharp envelope — tall in the middle, flat at edges — steady pulse
        const pulse = 0.75 + Math.sin(t * 3.2) * 0.18;
        a = Math.pow(envelope, 1.6) * pulse + 0.08;
        break;
      }
      case 'thinking': {
        // Traveling shimmer — a gaussian bump moves across the bars
        const travel = ((t * 0.7) % 2) - 0.5;              // -0.5..1.5
        const pos = i / (BAR_COUNT - 1);                   // 0..1
        const bump = Math.exp(-Math.pow((pos - travel) / 0.22, 2));
        const base = 0.12 + Math.sin(t * 1.4 + i * 0.3) * 0.04;
        a = base + bump * 0.72;
        break;
      }
      case 'speaking': {
        // Articulated speech — multiple sinusoids, envelope centered
        const f1 = Math.sin(t * 7.2 + i * 0.42) * 0.5;
        const f2 = Math.sin(t * 11.1 + i * 0.19 + 1.3) * 0.32;
        const f3 = Math.sin(t * 4.8 + i * 0.75) * 0.22;
        const raw = (f1 + f2 + f3 + 1.1) * 0.5;            // 0..~1
        a = raw * envelope * 0.92 + 0.06;
        break;
      }
      case 'idle':
      default: {
        // Ambient — low, slow rolling ripple across bars
        const w1 = Math.sin(t * 1.2 + i * 0.35) * 0.12;
        const w2 = Math.sin(t * 0.6 + i * 0.18) * 0.07;
        a = 0.18 + (w1 + w2) * envelope;
        break;
      }
    }

    amps[i] = Math.max(0.04, Math.min(1, a));
  }
  return amps;
}

function WaveformOrb({ state, size, t }) {
  const amps = computeAmps(state, t);

  // Layout
  const W = 200;
  const H = 80;                     // shorter than tall — it's a meter
  const padX = 6;
  const gap = 2;
  const barW = (W - padX * 2 - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  const maxBarH = H - 8;

  // Technical color decision per state
  const stateColor = {
    idle:      'var(--fg-muted)',
    activated: 'var(--accent)',
    thinking:  'var(--warning)',
    speaking:  'var(--accent)',
  }[state] || 'var(--fg-muted)';

  // Compute overall amplitude (for frame glow)
  const peak = amps.reduce((m, a) => Math.max(m, a), 0);

  const displayH = size * (H / W);

  return (
    <div
      className="orb"
      style={{
        width: size,
        height: displayH,
        position: 'relative',
      }}
    >
      {/* Meter frame — subtle rounded rect background, technical */}
      <svg
        width={size}
        height={displayH}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"  stopColor={stateColor} stopOpacity="0.55"/>
            <stop offset="100%" stopColor={stateColor} stopOpacity="1"/>
          </linearGradient>
          <linearGradient id="barGradDim" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"  stopColor="var(--fg-faint)" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="var(--fg-muted)" stopOpacity="0.9"/>
          </linearGradient>
          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2"/>
          </filter>
        </defs>

        {/* Center gridline — subtle reference line */}
        <line
          x1={padX} x2={W - padX}
          y1={H/2} y2={H/2}
          stroke="var(--border)"
          strokeWidth="0.5"
          strokeDasharray="2 3"
          opacity={state === 'idle' ? 0.8 : 0.3}
        />

        {/* Bars — symmetric around center line */}
        <g>
          {amps.map((a, i) => {
            const h = Math.max(1.2, a * maxBarH);
            const x = padX + i * (barW + gap);
            const y = (H - h) / 2;
            // Fill color logic
            const fill = state === 'idle' ? 'url(#barGradDim)' : 'url(#barGrad)';
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(barW / 2, 1.5)}
                fill={fill}
              />
            );
          })}
        </g>

        {/* End-cap tick marks — tiny dots at extreme left/right at baseline */}
        <circle cx={padX - 1.5} cy={H/2} r="1.2" fill="var(--fg-faint)" opacity="0.6"/>
        <circle cx={W - padX + 1.5} cy={H/2} r="1.2" fill="var(--fg-faint)" opacity="0.6"/>

        {/* Activated — two triggered peak markers */}
        {state === 'activated' && (
          <g>
            <TriggerTick x={padX} H={H} color={stateColor}/>
            <TriggerTick x={W - padX} H={H} color={stateColor}/>
          </g>
        )}
      </svg>

      {/* Accent glow under the meter during active states */}
      {(state === 'activated' || state === 'speaking') && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${1 + peak * 0.15})`,
            width: size * 0.9,
            height: displayH * 1.6,
            borderRadius: '50%',
            background: `radial-gradient(ellipse, ${state === 'activated' ? 'var(--accent-soft)' : 'var(--accent-soft)'} 0%, transparent 60%)`,
            filter: 'blur(6px)',
            pointerEvents: 'none',
            zIndex: -1,
            transition: 'transform 0.12s',
          }}
        />
      )}
    </div>
  );
}

function TriggerTick({ x, H, color }) {
  // Small triangle marker above + below, indicating a triggered event
  return (
    <g>
      <polygon points={`${x-2},-3 ${x+2},-3 ${x},0`} fill={color} opacity="0.8"/>
      <polygon points={`${x-2},${H+3} ${x+2},${H+3} ${x},${H}`} fill={color} opacity="0.8"/>
    </g>
  );
}

Object.assign(window, { Orb });
