// Efeitos em volta do mascote (não amassam nem giram com o corpo): brilhos, notas, zzz, gota…
import { motion } from 'motion/react';
import type { MascotState } from '@shared/types';

/** Estrelinha de quatro pontas. */
const SPARK = 'M0 -4 Q0.5 -0.5 4 0 Q0.5 0.5 0 4 Q-0.5 0.5 -4 0 Q-0.5 -0.5 0 -4 Z';

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

/** Brilhos que acendem e apagam em volta dele. O `translate` fica no grupo de fora para a escala girar no próprio centro. */
function Sparkles({ spots, color = '#FFFFFF', every = 1.3 }: { spots: Array<[number, number, number]>; color?: string; every?: number }): React.JSX.Element {
  return (
    <g fill={color}>
      {spots.map(([x, y, size], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${size})`}>
          <motion.path d={SPARK} initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1, 0], opacity: [0, 1, 0], rotate: [0, 40] }} transition={{ duration: 0.9, repeat: Infinity, repeatDelay: every - 0.9 + i * 0.12, delay: i * (every / spots.length), ease: 'easeOut' }} />
        </g>
      ))}
    </g>
  );
}

export function Effects({ state, size }: { state: MascotState; size: number }): React.JSX.Element | null {
  switch (state) {
    case 'happy':
      return (
        <Sparkles
          spots={[
            [13, 30, 0.9],
            [88, 26, 1.1],
            [93, 62, 0.7],
          ]}
        />
      );
    case 'celebrating':
      return (
        <Sparkles
          every={0.95}
          color="#FDE68A"
          spots={[
            [10, 24, 1.1],
            [90, 20, 1.3],
            [96, 58, 0.8],
            [4, 60, 0.8],
            [50, 12, 1],
          ]}
        />
      );
    case 'attention':
      // Risquinhos de susto ao lado da cabeça.
      return (
        <g stroke="#FBBF24" strokeWidth={2} strokeLinecap="round">
          {[
            [84, 30, 90, 24],
            [88, 36, 96, 33],
            [79, 26, 81, 18],
          ].map(([x1, y1, x2, y2], i) => (
            <motion.path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} animate={{ opacity: [0, 1, 1, 0], pathLength: [0.2, 1, 1, 1] }} transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 1.15, delay: i * 0.05 }} />
          ))}
        </g>
      );
    case 'thinking':
      return (
        <g fill="#FFFFFF">
          {[0, 1, 2].map((i) => (
            <motion.circle key={i} cx={78 + i * 6} cy={24 - i * 6} r={1.8 + i * 0.6} animate={{ opacity: [0.15, 1, 0.15], y: [0, -1.5, 0] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.22 }} />
          ))}
        </g>
      );
    case 'dancing':
      if (size < 30) return null;
      return (
        <g fill="#FFFFFF">
          {[
            { x: 82, y: 34, dx: 8, delay: 0 },
            { x: 14, y: 30, dx: -8, delay: 0.9 },
          ].map((note, i) => (
            <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [0, note.dx * 0.5, note.dx], y: [0, -9, -18] }} transition={{ duration: 1.8, repeat: Infinity, delay: note.delay }}>
              <MusicNote x={note.x} y={note.y} double={i === 1} />
            </motion.g>
          ))}
        </g>
      );
    case 'sleepy':
      return (
        <g fill="#FFFFFF" fontFamily="Inter Variable, sans-serif" fontWeight={700}>
          {[0, 1, 2].map((i) => (
            <motion.text key={i} x={80} y={30} fontSize={8 + i * 2} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [0, 6, 10], y: [0, -10, -20] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.85 }}>
              z
            </motion.text>
          ))}
        </g>
      );
    case 'tired':
      return <motion.path d="M80 36 q 3 5 0 7 q -3 -2 0 -7 z" fill="#93C5FD" animate={{ y: [0, 6, 6], opacity: [1, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 0.8 }} />;
    case 'sad':
      // Uma lágrima de vez em quando.
      return <motion.path d="M37 63 q 2.4 4 0 5.6 q -2.4 -1.6 0 -5.6 z" fill="#93C5FD" animate={{ y: [0, 0, 11], opacity: [0, 1, 0] }} transition={{ duration: 1.9, times: [0, 0.25, 1], repeat: Infinity, repeatDelay: 2.6, ease: 'easeIn' }} />;
    case 'listening':
      return (
        <g stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" fill="none">
          {[0, 1, 2].map((i) => (
            <motion.path key={i} d={`M${95 + i * 5} ${50 - 4 - i * 2} q 3 ${4 + i * 2} 0 ${8 + i * 4}`} animate={{ opacity: [0.15, 0.9, 0.15] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }} />
          ))}
        </g>
      );
    default:
      return null;
  }
}
