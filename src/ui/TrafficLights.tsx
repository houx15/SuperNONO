import { invoke } from '@tauri-apps/api/core';

interface Props {
  theme: 'light' | 'dark';
}

export function TrafficLights({ theme }: Props) {
  const border =
    theme === 'dark' ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.06)';

  const dot = (bg: string, label: string, onClick: () => void) => (
    <button
      className="tl-dot"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: bg,
        border,
        cursor: 'default',
        padding: 0,
      }}
    />
  );

  return (
    <div className="traffic-lights" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {dot('#ff5f57', 'close', () => invoke('window_close').catch(() => {}))}
      {dot('#febc2e', 'minimize', () => invoke('window_minimize').catch(() => {}))}
      {dot('#28c840', 'maximize', () => invoke('window_toggle_maximize').catch(() => {}))}
    </div>
  );
}
