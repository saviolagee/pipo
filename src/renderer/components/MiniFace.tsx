/** Mini-mascote colorido usado nos chips de integração e na pill [Ref 3, 7]. */
export function MiniFace({ color, size = 18, dim = false }: { color: string; size?: number; dim?: boolean }): React.JSX.Element {
  const h = size * 0.8;
  return (
    <svg width={size} height={h} viewBox="0 0 20 16" aria-hidden style={{ opacity: dim ? 0.4 : 1, flexShrink: 0 }}>
      <rect x={0.5} y={0.5} width={19} height={15} rx={5} fill={color} />
      <ellipse cx={7.3} cy={8.6} rx={1.25} ry={1.9} fill="rgba(0,0,0,0.72)" />
      <ellipse cx={12.7} cy={8.6} rx={1.25} ry={1.9} fill="rgba(0,0,0,0.72)" />
    </svg>
  );
}

export const INTEGRATION_COLORS = {
  google_calendar: '#3B82F6',
  gmail: '#EF4444',
  spotify: '#22C55E',
  claude: '#F97316',
} as const;
