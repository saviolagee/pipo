import { motion } from 'motion/react';
import type { Accessory } from '@shared/types';
import { BODY } from './rig/poses';

// Camadas SVG desenhadas no mesmo viewBox 0..100 do mascote (a bola fica em x 22..78, y 30..84,
// com os olhos na altura 52 e a boca na 70).

export function CapeBehind(): React.JSX.Element {
  return (
    <motion.g animate={{ skewX: [0, 3, 0, -2, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} style={{ transformOrigin: '50px 44px' }}>
      <path d="M27 44 C 18 60, 12 80, 10 95 Q 50 101 90 95 C 88 80, 82 60, 73 44 Z" fill="#DC2626" />
      <path d="M27 44 C 20 60, 16 79, 14 93 Q 23 95 31 95 C 29 76, 30 58, 33 44 Z" fill="#B91C1C" opacity={0.6} />
    </motion.g>
  );
}

export function AccessoriesFront({ items, sipping }: { items: Accessory[]; sipping: boolean }): React.JSX.Element {
  const has = (a: Accessory): boolean => items.includes(a);
  return (
    <g>
      {has('pajama') && (
        // Pijama listrado de folga: listras azuis recortadas no corpo + golinha.
        <g>
          <clipPath id="pipo-pajama-clip">
            <path d={BODY} />
          </clipPath>
          <g clipPath="url(#pipo-pajama-clip)" fill="#93C5FD" opacity={0.42}>
            {Array.from({ length: 7 }, (_, i) => (
              <rect key={i} x={23 + i * 8.6} y={30} width={3.4} height={54} />
            ))}
          </g>
          <path d="M41 83.5 L50 76.5 L59 83.5" fill="none" stroke="#60A5FA" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      )}
      {has('scarf') && (
        <g>
          <path d="M29.5 73.5 Q50 83 70.5 73.5 L72 79 Q50 89.5 28 79 Z" fill="#EF4444" />
          <path d="M29.5 73.5 Q50 83 70.5 73.5 L70.9 75.4 Q50 85 29.1 75.4 Z" fill="#F87171" />
          <path d="M60 81.5 h8 l2 12.5 h-8 z" fill="#DC2626" />
          <path d="M62 92 v3 M65 92 v3 M68 92 v3" stroke="#FCA5A5" strokeWidth={1} />
        </g>
      )}
      {has('glasses') && (
        <g stroke="#18181B" strokeWidth={1.6} fill="rgba(255,255,255,0.12)">
          <ellipse cx={39.5} cy={53} rx={9.4} ry={7.2} />
          <ellipse cx={60.5} cy={53} rx={9.4} ry={7.2} />
          <path d="M48.9 52 Q50 51 51.1 52" fill="none" />
        </g>
      )}
      {has('cool_glasses') && (
        <g>
          <path d="M29.5 47 h19.5 v5.2 a6 6 0 0 1 -6 6 h-7.5 a6 6 0 0 1 -6 -6 z" fill="#0A0A0B" />
          <path d="M51 47 h19.5 v5.2 a6 6 0 0 1 -6 6 h-7.5 a6 6 0 0 1 -6 -6 z" fill="#0A0A0B" />
          <rect x={48} y={47.4} width={4} height={2} fill="#0A0A0B" />
          <path d="M33 49.4 l4.5 0 M54.5 49.4 l4.5 0" stroke="rgba(255,255,255,0.55)" strokeWidth={1.3} strokeLinecap="round" />
        </g>
      )}
      {has('hat') && (
        <g>
          <ellipse cx={50} cy={34} rx={22} ry={3.5} fill="#18181B" />
          <rect x={37.5} y={15.5} width={25} height={19} rx={2.5} fill="#18181B" />
          <rect x={37.5} y={28.5} width={25} height={3.6} fill="#7C3AED" />
        </g>
      )}
      {has('crown') && (
        <g>
          <path d="M34.5 35.5 L35.5 21.5 L42.5 28.5 L50 17.5 L57.5 28.5 L64.5 21.5 L65.5 35.5 Z" fill="#FACC15" stroke="#EAB308" strokeWidth={1} strokeLinejoin="round" />
          <circle cx={50} cy={29.5} r={2} fill="#EF4444" />
          <circle cx={41.5} cy={31.5} r={1.4} fill="#3B82F6" />
          <circle cx={58.5} cy={31.5} r={1.4} fill="#22C55E" />
        </g>
      )}
      {has('cap') && (
        // Boné com aba para a frente.
        <g>
          <path d="M30.5 39 Q 31 20.5 50 19.5 Q 69 20.5 69.5 39 Q 50 34.5 30.5 39 Z" fill="#18181B" />
          <path d="M58 35.2 Q 78 32.5 87.5 38.5 Q 76 41.5 61 39.2 Z" fill="#27272A" />
          <circle cx={50} cy={20.5} r={2} fill="#3F3F46" />
        </g>
      )}
      {has('beanie') && (
        <g>
          <path d="M29.5 40.5 Q 30 17 50 16 Q 70 17 70.5 40.5 Z" fill="#7C3AED" />
          <path d="M27.5 37 Q50 31 72.5 37 L72.5 43 Q50 37 27.5 43 Z" fill="#A78BFA" />
          <circle cx={50} cy={14} r={4.2} fill="#EDE9FE" />
        </g>
      )}
      {has('bow') && (
        <g transform="translate(67.5 35.5) rotate(18)">
          <path d="M0 0 L-9 -6 L-9 6 Z" fill="#F43F5E" />
          <path d="M0 0 L9 -6 L9 6 Z" fill="#F43F5E" />
          <circle cx={0} cy={0} r={2.6} fill="#BE123C" />
        </g>
      )}
      {has('tie') && (
        <g>
          <path d="M46 81.5 h8 l-1.5 3 h-5 z" fill="#1E3A8A" />
          <path d="M47.5 84.5 h5 l3 10 -5.5 4.5 -5.5 -4.5 z" fill="#2563EB" />
        </g>
      )}
      {has('magnifier') && (
        <g transform="translate(85 64) rotate(-30)">
          <rect x={-1.6} y={6} width={3.2} height={12} rx={1.6} fill="#92400E" />
          <circle cx={0} cy={0} r={7} fill="rgba(186,230,253,0.35)" stroke="#3F3F46" strokeWidth={2.2} />
          <path d="M-3 -3 q 2 -2 4 -1.5" stroke="#FFFFFF" strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.8} />
        </g>
      )}
      {has('pencil') && (
        <g transform="translate(73.5 31) rotate(35)">
          <rect x={-2} y={0} width={4} height={18} fill="#FACC15" />
          <rect x={-2} y={-3} width={4} height={3} fill="#F9A8D4" />
          <path d="M-2 18 L0 23 L2 18 Z" fill="#FDE68A" />
          <path d="M-0.7 21 L0 23 L0.7 21 Z" fill="#18181B" />
        </g>
      )}
      {has('nightcap') && (
        <g>
          <path d="M28.5 42 Q 41 17.5 67.5 21 Q 81.5 23 88 33 Q 75 29.5 71 33.5 Q 76 38 73 43 Q 50 35.5 28.5 42 Z" fill="#6366F1" />
          <path d="M27 38.2 Q50 31.6 73.8 38.2 L73.8 44 Q50 37.4 27 44 Z" fill="#E0E7FF" />
          <circle cx={88} cy={34} r={4} fill="#F4F4F5" />
        </g>
      )}
      {has('headphones') && (
        <g>
          <path d="M20.5 56 C 20.5 22, 79.5 22, 79.5 56" stroke="#27272A" strokeWidth={4.2} fill="none" strokeLinecap="round" />
          <rect x={14.5} y={47} width={10} height={17} rx={4.5} fill="#3F3F46" />
          <rect x={75.5} y={47} width={10} height={17} rx={4.5} fill="#3F3F46" />
          <rect x={17} y={50} width={4} height={11} rx={2} fill="#3B82F6" />
          <rect x={79} y={50} width={4} height={11} rx={2} fill="#3B82F6" />
        </g>
      )}
      {has('coffee') && (
        <motion.g
          animate={sipping ? { x: [0, -10, -10, 0], y: [0, -10, -10, 0], rotate: [0, -25, -25, 0] } : { x: 0, y: 0, rotate: 0 }}
          transition={sipping ? { duration: 1.8, times: [0, 0.3, 0.7, 1] } : { duration: 0.3 }}
          style={{ transformOrigin: '85px 79px' }}
        >
          <path d="M79 69 h12 v10 a4 4 0 0 1 -4 4 h-4 a4 4 0 0 1 -4 -4 z" fill="#F4F4F5" stroke="#D4D4D8" strokeWidth={0.8} />
          <path d="M91 72 a3 3 0 0 1 0 6" stroke="#D4D4D8" strokeWidth={1.6} fill="none" />
          <rect x={79.6} y={69.6} width={10.8} height={2.4} rx={1} fill="#92400E" />
          <motion.path
            d="M83 65 q-1.5 -2 0 -4 M87 65 q-1.5 -2 0 -4"
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
