// desktop-shell.jsx — macOS-style desktop window shell for SuperNono
// Custom traffic lights + titlebar + sidebar, themed for light/dark

function TrafficLights({ onClose, theme = 'light' }) {
  const dot = (bg, label) => (
    <div
      className="tl-dot"
      style={{
        width: 12, height: 12, borderRadius: '50%',
        background: bg,
        border: theme === 'dark'
          ? '0.5px solid rgba(255,255,255,0.08)'
          : '0.5px solid rgba(0,0,0,0.06)',
        cursor: 'default',
      }}
      aria-label={label}
    />
  );
  return (
    <div
      className="traffic-lights"
      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
    >
      {dot('#ff5f57', 'close')}
      {dot('#febc2e', 'minimize')}
      {dot('#28c840', 'maximize')}
    </div>
  );
}

// Unified title bar (draggable zone, no tabs — this is a desktop app)
function DesktopTitlebar({ title = 'SuperNono', sessionId, theme, children }) {
  return (
    <div className="ds-titlebar">
      <div className="ds-titlebar-left">
        <TrafficLights theme={theme}/>
      </div>
      <div className="ds-titlebar-center">
        <span className="ds-title">{title}</span>
        {sessionId && (
          <>
            <span className="ds-title-sep">·</span>
            <span className="ds-title-session">{sessionId}</span>
          </>
        )}
      </div>
      <div className="ds-titlebar-right">
        {children}
      </div>
    </div>
  );
}

// Desktop shell — window with macOS chrome
function DesktopWindow({ width, height, theme = 'light', children }) {
  const shadow = theme === 'dark'
    ? '0 0 0 0.5px rgba(255,255,255,0.08), 0 24px 80px rgba(0,0,0,0.6)'
    : '0 0 0 0.5px rgba(0,0,0,0.08), 0 24px 80px rgba(17,24,39,0.22)';
  return (
    <div
      className="desktop-window"
      style={{
        width, height,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: shadow,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
      }}
    >
      {children}
    </div>
  );
}

Object.assign(window, {
  TrafficLights, DesktopTitlebar, DesktopWindow,
});
