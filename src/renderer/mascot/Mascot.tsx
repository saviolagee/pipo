import { motion, type TargetAndTransition, type Transition } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type { Accessory, MascotState } from '@shared/types';
import { AccessoriesFront, CapeBehind } from './Accessories';
import { EYE_Y, Eyes } from './Eyes';
import { moodBand } from './mood';

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

function bodyMotion(state: MascotState, mood: number, still: boolean): { animate: TargetAndTransition; transition: Transition } {
  if (still) return { animate: { y: 0, x: 0, rotate: 0, scaleX: 1, scaleY: 1 }, transition: { duration: 0.2 } };
  const band = moodBand(mood);
  switch (state) {
    case 'happy':
      return {
        animate: { y: [0, -9, 0, 0], scaleX: [1, 0.92, 1.12, 1], scaleY: [1, 1.1, 0.88, 1], rotate: 0, x: 0 },
        transition: { duration: 0.65, times: [0, 0.35, 0.7, 1], ease: 'easeOut' },
      };
    case 'celebrating':
      return {
        animate: { y: [0, -16, 0, 0], rotate: [0, 360, 360, 360], scaleX: [1, 0.92, 1.12, 1], scaleY: [1, 1.1, 0.88, 1], x: 0 },
        transition: { duration: 1, times: [0, 0.45, 0.8, 1], repeat: 1, repeatDelay: 0.4, ease: 'easeOut' },
      };
    case 'attention':
      return {
        animate: { x: [0, -1.4, 1.4, -1.4, 1.4, 0], y: 0, rotate: 0, scaleX: 1, scaleY: 1 },
        transition: { duration: 0.45, repeat: Infinity, repeatDelay: 1.4 },
      };
    case 'dizzy':
      return { animate: { rotate: [-9, 9, -9], x: [-1.5, 1.5, -1.5], y: 0, scaleX: 1, scaleY: 1 }, transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } };
    case 'sad':
      return { animate: { y: 3, scaleY: 0.94, scaleX: 1.03, rotate: 0, x: 0 }, transition: { type: 'spring', stiffness: 120, damping: 14 } };
    case 'tired':
      return { animate: { y: [2, 3, 2], scaleY: [0.96, 0.94, 0.96], scaleX: 1.02, rotate: 0, x: 0 }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } };
    case 'sleepy':
      return { animate: { y: [1, 2, 1], scaleY: [1, 0.96, 1], scaleX: [1, 1.02, 1], rotate: 0, x: 0 }, transition: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' } };
    case 'working':
      return { animate: { y: [0, -1.2, 0], rotate: 0, x: 0, scaleX: 1, scaleY: 1 }, transition: { duration: 0.55, repeat: Infinity, ease: 'easeInOut' } };
    case 'eating':
      return { animate: { scaleY: [1, 1.08, 1], scaleX: [1, 0.96, 1], y: 0, rotate: 0, x: 0 }, transition: { duration: 0.9, repeat: Infinity } };
    case 'listening':
      return { animate: { scale: [1, 1.03, 1], y: 0, rotate: 0, x: 0 }, transition: { duration: 1.2, repeat: Infinity } };
    case 'thinking':
      return { animate: { y: [0, -1.5, 0], rotate: [0, -3, 0], x: 0, scaleX: 1, scaleY: 1 }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } };
    case 'dancing':
      // Balanço lado a lado com quique a cada batida (~120 bpm): amassa ao pousar, estica no ar.
      return {
        animate: {
          y: [0, -4, 0, -4, 0],
          x: [-1.5, 0, 1.5, 0, -1.5],
          rotate: [-7, 0, 7, 0, -7],
          scaleX: [1.04, 0.97, 1.04, 0.97, 1.04],
          scaleY: [0.95, 1.04, 0.95, 1.04, 0.95],
        },
        transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
      };
    default: {
      // idle / looking / shh: flutuação ±2px em 3s, ajustada pelo humor (seção 6.3).
      if (band === 'high') return { animate: { y: [0, -3, 0], scaleY: [1, 1.02, 1], rotate: 0, x: 0, scaleX: 1 }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } };
      if (band === 'low') return { animate: { y: [1, -0.8, 1], rotate: 0, x: 0, scaleX: 1.02, scaleY: 0.98 }, transition: { duration: 4.4, repeat: Infinity, ease: 'easeInOut' } };
      if (band === 'veryLow')
        // Suspiro: sobe e desce devagar.
        return { animate: { y: [1.5, -1.5, 2, 1.5], scaleY: [0.97, 1.03, 0.96, 0.97], rotate: 0, x: 0, scaleX: 1.02 }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } };
      return { animate: { y: [0, -2, 0], rotate: 0, x: 0, scaleX: 1, scaleY: 1 }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } };
    }
  }
}

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

/** Pulinho espontâneo quando o humor está alto. */
function useSpontaneousHop(active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((v) => v + 1), 9000 + Math.random() * 6000);
    return () => clearInterval(id);
  }, [active]);
  return n;
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

/** Colcheia (♪) ou duas colcheias ligadas (♫), desenhadas em vetor (não depende da fonte). */
function MusicNote({ x, y, double = false }: { x: number; y: number; double?: boolean }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={0} rx={2.6} ry={1.9} transform="rotate(-20)" />
      <rect x={1.6} y={-9} width={1.1} height={9} rx={0.5} />
      {double ? (
        <>
          <ellipse cx={7} cy={-1.5} rx={2.6} ry={1.9} transform="rotate(-20 7 -1.5)" />
          <rect x={8.6} y={-10.5} width={1.1} height={9} rx={0.5} />
          <path d="M1.6 -9 L9.7 -10.5 L9.7 -8.4 L1.6 -6.9 Z" />
        </>
      ) : (
        <path d="M2.2 -9 q 4.2 1.6 3.4 6.2 q -0.6 -3 -3.4 -3.6 z" />
      )}
    </g>
  );
}

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
  const hop = useSpontaneousHop(band === 'high' && state === 'idle' && !still);
  const { animate, transition } = bodyMotion(state, mood, still);
  const px = (size * 100) / 64;
  const shadow = glow ? `drop-shadow(0 0 ${Math.max(2, (18 * size) / 64)}px ${color ? `${color}73` : `rgba(255,255,255,${band === 'veryLow' ? 0.2 : 0.35})`})` : 'none';
  const bodyTop = color ?? (band === 'veryLow' ? '#E4E4E7' : '#FFFFFF');
  const bodyBottom = color ? shade(color, -0.14) : band === 'veryLow' ? '#D4D4D8' : '#E9E9EE';
  const cheeks = state === 'celebrating' || state === 'dizzy' || (state === 'happy' && band === 'high');
  const typing = state === 'working' && !still;
  const dancing = state === 'dancing' && !still;

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

      <motion.g key={`hop-${bump}-${hop}`} initial={bump || hop ? { y: 0, scaleX: 1, scaleY: 1 } : false} animate={bump || hop ? { y: [0, -8, 0, 0], scaleX: [1, 0.92, 1.12, 1], scaleY: [1, 1.1, 0.88, 1] } : {}} transition={{ duration: 0.5, times: [0, 0.35, 0.7, 1] }} style={{ transformOrigin: '50px 80px' }}>
        <motion.g initial={false} animate={animate} transition={transition} style={{ transformOrigin: '50px 80px' }}>
          {auto.includes('cape') && <CapeBehind />}
          <rect x={18} y={32} width={64} height={48} rx={16} fill={`url(#body-${uid})`} />
          {/* Brilho sutil no topo do corpo */}
          <rect x={27} y={34.5} width={28} height={4} rx={2} fill="#FFFFFF" opacity={0.55} />

          {state === 'eating' && (
            <motion.ellipse cx={50} cy={37} rx={11} fill="#18181B" initial={{ ry: 0 }} animate={{ ry: [3, 6, 3] }} transition={{ duration: 0.9, repeat: Infinity }} />
          )}

          <Eyes state={state} mood={mood} look={state === 'looking' || state === 'idle' ? look : null} blink={!still} />

          {cheeks && (
            <g fill="#F9A8C0" opacity={0.55}>
              <ellipse cx={32} cy={EYE_Y + 7} rx={5} ry={2.8} />
              <ellipse cx={68} cy={EYE_Y + 7} rx={5} ry={2.8} />
            </g>
          )}

          <AccessoriesFront items={auto} sipping={sipping} />

          {dancing && (
            // Mãozinhas para cima, alternadas no ritmo.
            <g fill="#FFFFFF">
              {[-1, 1].map((side) => (
                <motion.circle
                  key={side}
                  cx={50 + side * 37}
                  cy={58}
                  r={4.2}
                  animate={{ y: side < 0 ? [0, -12, 0, 0, 0] : [0, 0, 0, -12, 0] }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                />
              ))}
            </g>
          )}

          {state === 'shh' && (
            <g>
              <rect x={47.5} y={62} width={5} height={12} rx={2.5} fill="#FFFFFF" stroke="#D4D4D8" strokeWidth={0.6} />
              <circle cx={50} cy={75} r={4.5} fill="#FFFFFF" stroke="#D4D4D8" strokeWidth={0.6} />
            </g>
          )}
        </motion.g>

        {hands === 'open' && (
          <g fill="#FFFFFF">
            <circle cx={10} cy={56} r={4.2} />
            <circle cx={90} cy={50} r={4.2} />
          </g>
        )}

        {typing && (
          <g>
            <rect x={24} y={79} width={52} height={10} rx={2.6} fill="#3F3F46" />
            {Array.from({ length: 8 }, (_, i) => (
              <rect key={i} x={27 + i * 6} y={81.5} width={4.2} height={2} rx={0.6} fill="#71717A" />
            ))}
            <rect x={33} y={85} width={34} height={2} rx={0.8} fill="#71717A" />
            <motion.circle cx={38} cy={80} r={4} fill="#FFFFFF" animate={{ y: [0, -3, 0, 0] }} transition={{ duration: 0.36, repeat: Infinity, times: [0, 0.3, 0.6, 1] }} />
            <motion.circle cx={62} cy={80} r={4} fill="#FFFFFF" animate={{ y: [0, 0, -3, 0] }} transition={{ duration: 0.36, repeat: Infinity, times: [0, 0.4, 0.7, 1] }} />
          </g>
        )}
      </motion.g>

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

      {!still && state === 'thinking' && (
        <g fill="#FFFFFF">
          {[0, 1, 2].map((i) => (
            <motion.circle key={i} cx={78 + i * 6} cy={24 - i * 6} r={1.8 + i * 0.5} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
          ))}
        </g>
      )}

      {dancing && size >= 30 && (
        <g fill="#FFFFFF">
          {[
            { x: 82, y: 34, dx: 8, delay: 0 },
            { x: 14, y: 30, dx: -8, delay: 0.9 },
          ].map((n, i) => (
            <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [0, n.dx * 0.5, n.dx], y: [0, -9, -18] }} transition={{ duration: 1.8, repeat: Infinity, delay: n.delay }}>
              <MusicNote x={n.x} y={n.y} double={i === 1} />
            </motion.g>
          ))}
        </g>
      )}

      {!still && state === 'sleepy' && (
        <g fill="#FFFFFF" fontFamily="Inter Variable, sans-serif" fontWeight={700}>
          {[0, 1, 2].map((i) => (
            <motion.text key={i} x={80} y={30} fontSize={8 + i * 2} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [0, 6, 10], y: [0, -10, -20] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.85 }}>
              z
            </motion.text>
          ))}
        </g>
      )}

      {!still && state === 'tired' && (
        <motion.path d="M80 36 q 3 5 0 7 q -3 -2 0 -7 z" fill="#93C5FD" animate={{ y: [0, 6, 6], opacity: [1, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 0.8 }} />
      )}

      {!still && state === 'listening' && (
        <g stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" fill="none">
          {[0, 1, 2].map((i) => (
            <motion.path key={i} d={`M${88 + i * 5} ${50 - 4 - i * 2} q ${3} ${4 + i * 2} 0 ${8 + i * 4}`} animate={{ opacity: [0.15, 0.9, 0.15] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }} />
          ))}
        </g>
      )}
    </svg>
  );
}
