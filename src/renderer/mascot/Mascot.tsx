import { motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type { Accessory, MascotState } from '@shared/types';
import { moodBand } from './mood';
import { Effects } from './rig/Effects';
import { Rig } from './rig/Rig';

export type Badge = 'working' | 'done' | 'attention' | null;

export interface MascotProps {
  state: MascotState;
  mood?: number;
  accessories?: Accessory[];
  /** Largura do corpo em px (o SVG é ~1.56x maior para caber acessórios e efeitos). */
  size?: number;
  badge?: Badge;
  /** Direção do olhar normalizada (-1..1). */
  look?: { x: number; y: number } | null;
  /** Incrementar para disparar um pulinho com squash & stretch. */
  bump?: number;
  hands?: 'open' | null;
  glow?: boolean;
  /** Remove animações contínuas (ícones minúsculos, ghosts). */
  still?: boolean;
  /** Cor do corpo (Pipos coloridos). Padrão: branco marshmallow. */
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

const BADGE_COLOR: Record<Exclude<Badge, null>, string> = {
  working: '#3B82F6',
  done: '#22C55E',
  attention: '#F59E0B',
};

function useSip(active: boolean): boolean {
  const [sip, setSip] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setSip(true);
      setTimeout(() => setSip(false), 1900);
    }, 14000 + Math.random() * 8000);
    return () => clearInterval(id);
  }, [active]);
  return sip;
}

/** Escurece (amount < 0) ou clareia uma cor #RRGGBB. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c : 255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * O mascote. O desenho e a animação ficam no boneco (rig/): poses por expressão, molas entre uma
 * e outra, pulo com gravidade, piscadas e olhadelas. Aqui ficam a moldura, as cores e o badge.
 */
export function Mascot({
  state,
  mood = 60,
  accessories = [],
  size = 64,
  badge = null,
  look = null,
  bump = 0,
  hands = null,
  glow = true,
  still = false,
  color,
  className,
  style,
  onClick,
  title,
}: MascotProps): React.JSX.Element {
  const uid = useId().replace(/:/g, '');
  const band = moodBand(mood);
  const auto: Accessory[] = [...accessories];
  if (state === 'sleepy' && !auto.includes('nightcap')) auto.push('nightcap');
  const sipping = useSip(state === 'working' && auto.includes('coffee') && !still);
  const px = (size * 100) / 64;
  const shadow = glow ? `drop-shadow(0 0 ${Math.max(2, (18 * size) / 64)}px ${color ? `${color}73` : `rgba(255,255,255,${band === 'veryLow' ? 0.2 : 0.35})`})` : 'none';
  const bodyTop = color ?? (band === 'veryLow' ? '#E4E4E7' : '#FFFFFF');
  const bodyBottom = color ? shade(color, -0.14) : band === 'veryLow' ? '#D4D4D8' : '#E9E9EE';

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      className={className}
      style={{ overflow: 'visible', filter: shadow, ...style }}
      onClick={onClick}
      role="img"
      aria-label={title ?? `Pipo (${state})`}
    >
      <defs>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={bodyTop} />
          <stop offset="100%" stopColor={bodyBottom} />
        </linearGradient>
      </defs>

      <Rig
        state={state}
        band={band}
        mood={mood}
        accessories={auto}
        look={look}
        bump={bump}
        hands={hands}
        still={still}
        sipping={sipping}
        bodyFill={`url(#body-${uid})`}
        // Luvinhas: brancas no Pipo branco, um tom mais claro que o corpo nos coloridos.
        handFill={color ? shade(color, 0.45) : '#FFFFFF'}
        shine={size >= 34}
      />

      {badge && (
        <motion.g
          initial={{ scale: 0 }}
          animate={badge === 'attention' && !still ? { scale: 1, y: [0, -2.5, 0] } : { scale: 1 }}
          transition={badge === 'attention' ? { y: { duration: 0.6, repeat: Infinity, repeatDelay: 0.6 }, scale: { type: 'spring', stiffness: 500, damping: 20 } } : { type: 'spring', stiffness: 500, damping: 20 }}
          style={{ transformOrigin: '21px 35px' }}
        >
          <circle cx={21} cy={35} r={7} fill={BADGE_COLOR[badge]} stroke="#000" strokeWidth={1.2} />
          {badge === 'attention' && (
            <text x={21} y={38.6} textAnchor="middle" fontSize={10} fontWeight={800} fill="#1C1917" fontFamily="Inter Variable, sans-serif">
              !
            </text>
          )}
          {badge === 'working' && (
            <g fill="#000" opacity={0.55}>
              <circle cx={18.6} cy={35} r={1.2} />
              <circle cx={23.4} cy={35} r={1.2} />
            </g>
          )}
        </motion.g>
      )}

      {!still && <Effects state={state} size={size} />}
    </svg>
  );
}
