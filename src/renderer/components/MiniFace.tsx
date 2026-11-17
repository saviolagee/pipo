/** O rosto do Pipo em miniatura (bola, olhar de canto, boca reta e a língua): chips de integração e listas. */
export function MiniFace({ color, size = 18, dim = false }: { color: string; size?: number; dim?: boolean }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden style={{ opacity: dim ? 0.4 : 1, flexShrink: 0 }}>
      <circle cx={10} cy={10} r={9.2} fill={color} stroke="rgba(0,0,0,0.75)" strokeWidth={1} />
      <g fill="rgba(0,0,0,0.78)">
        {/* Meias-luas: a pálpebra reta em cima, o olho embaixo. */}
        <path d="M3.9 7.6 L8.9 8.9 Q7 11.6 4.6 9.9 Z" />
        <path d="M11.1 8.9 L16.1 8 Q15.6 10.9 12.6 10.6 Z" />
      </g>
      <path d="M6.2 14 H13.8" stroke="rgba(0,0,0,0.78)" strokeWidth={1.2} strokeLinecap="round" />
      {size >= 14 && <path d="M11 14 v1.6 a1.1 1.1 0 0 0 2.2 0 V14 Z" fill="#F4A3A0" stroke="rgba(0,0,0,0.78)" strokeWidth={0.7} />}
    </svg>
  );
}

export const INTEGRATION_COLORS = {
  google_calendar: '#3B82F6',
  gmail: '#EF4444',
  spotify: '#22C55E',
  claude: '#F97316',
} as const;
