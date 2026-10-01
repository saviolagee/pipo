import { motion } from 'motion/react';
import type { Accessory } from '@shared/types';

// Camadas SVG desenhadas no mesmo viewBox 0..100 do mascote (corpo em x 18..82, y 28..84).

export function CapeBehind(): React.JSX.Element {
  return (
    <motion.g animate={{ skewX: [0, 3, 0, -2, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} style={{ transformOrigin: '50px 40px' }}>
      <path d="M24 42 C 16 60, 10 80, 8 94 Q 50 100 92 94 C 90 80, 84 60, 76 42 Z" fill="#DC2626" />
      <path d="M24 42 C 18 60, 14 78, 12 92 Q 22 94 30 94 C 28 74, 28 56, 30 42 Z" fill="#B91C1C" opacity={0.6} />
    </motion.g>
  );
}

export function AccessoriesFront({ items, sipping }: { items: Accessory[]; sipping: boolean }): React.JSX.Element {
  const has = (a: Accessory): boolean => items.includes(a);
  return (
    <g>
      {has('scarf') && (
        <g>
          <rect x={19} y={70} width={62} height={8} rx={4} fill="#EF4444" />
          <rect x={19} y={70} width={62} height={2.4} rx={1.2} fill="#F87171" />
          <path d="M62 76 h8 l2 15 h-8 z" fill="#DC2626" />
          <path d="M64 89 v3 M67 89 v3 M70 89 v3" stroke="#FCA5A5" strokeWidth={1} />
        </g>
      )}
      {has('glasses') && (
        <g stroke="#18181B" strokeWidth={1.5} fill="rgba(255,255,255,0.15)">
          <circle cx={39} cy={57} r={6.4} />
          <circle cx={61} cy={57} r={6.4} />
          <path d="M45.4 56.4 Q50 54.4 54.6 56.4" fill="none" />
        </g>
      )}
      {has('cool_glasses') && (
        <g>
          <path d="M30 52.5 h15.5 v4.2 a4.6 4.6 0 0 1 -4.6 4.6 h-6.3 a4.6 4.6 0 0 1 -4.6 -4.6 z" fill="#0A0A0B" />
          <path d="M54.5 52.5 h15.5 v4.2 a4.6 4.6 0 0 1 -4.6 4.6 h-6.3 a4.6 4.6 0 0 1 -4.6 -4.6 z" fill="#0A0A0B" />
          <rect x={45} y={53} width={10} height={1.8} fill="#0A0A0B" />
          <path d="M33 54.5 l3.5 0 M57.5 54.5 l3.5 0" stroke="rgba(255,255,255,0.55)" strokeWidth={1.2} strokeLinecap="round" />
        </g>
      )}
      {has('hat') && (
        <g>
          <ellipse cx={50} cy={33.5} rx={23} ry={3.6} fill="#18181B" />
          <rect x={37} y={15} width={26} height={19} rx={2.5} fill="#18181B" />
          <rect x={37} y={28} width={26} height={3.6} fill="#7C3AED" />
        </g>
      )}
      {has('crown') && (
        <g>
          <path d="M34 35 L35 21 L42 28 L50 17 L58 28 L65 21 L66 35 Z" fill="#FACC15" stroke="#EAB308" strokeWidth={1} strokeLinejoin="round" />
          <circle cx={50} cy={29} r={2} fill="#EF4444" />
          <circle cx={41} cy={31} r={1.4} fill="#3B82F6" />
          <circle cx={59} cy={31} r={1.4} fill="#22C55E" />
        </g>
      )}
      {has('nightcap') && (
        <g>
          <path d="M24 40 Q 40 18 70 22 Q 84 24 90 34 Q 76 30 72 34 Q 78 38 76 42 Z" fill="#6366F1" />
          <rect x={22} y={36} width={56} height={7} rx={3.5} fill="#E0E7FF" />
          <circle cx={90} cy={35} r={4} fill="#F4F4F5" />
        </g>
      )}
      {has('headphones') && (
        <g>
          <path d="M19 54 C 19 26, 81 26, 81 54" stroke="#27272A" strokeWidth={4.2} fill="none" strokeLinecap="round" />
          <rect x={12} y={44} width={10} height={17} rx={4.5} fill="#3F3F46" />
          <rect x={78} y={44} width={10} height={17} rx={4.5} fill="#3F3F46" />
          <rect x={14.5} y={47} width={4} height={11} rx={2} fill="#3B82F6" />
          <rect x={81.5} y={47} width={4} height={11} rx={2} fill="#3B82F6" />
        </g>
      )}
      {has('coffee') && (
        <motion.g
          animate={sipping ? { x: [0, -10, -10, 0], y: [0, -10, -10, 0], rotate: [0, -25, -25, 0] } : { x: 0, y: 0, rotate: 0 }}
          transition={sipping ? { duration: 1.8, times: [0, 0.3, 0.7, 1] } : { duration: 0.3 }}
          style={{ transformOrigin: '86px 76px' }}
        >
          <path d="M80 66 h12 v10 a4 4 0 0 1 -4 4 h-4 a4 4 0 0 1 -4 -4 z" fill="#F4F4F5" stroke="#D4D4D8" strokeWidth={0.8} />
          <path d="M92 69 a3 3 0 0 1 0 6" stroke="#D4D4D8" strokeWidth={1.6} fill="none" />
          <rect x={80.6} y={66.6} width={10.8} height={2.4} rx={1} fill="#92400E" />
          <motion.path
            d="M84 62 q-1.5 -2 0 -4 M88 62 q-1.5 -2 0 -4"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1}
            fill="none"
            strokeLinecap="round"
            animate={{ opacity: [0, 0.8, 0], y: [0, -3, -5] }}
            transition={{ duration: 2.4, repeat: Infinity }}
          />
        </motion.g>
      )}
    </g>
  );
}
