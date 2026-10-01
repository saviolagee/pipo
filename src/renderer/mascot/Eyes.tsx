import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { MascotState } from '@shared/types';

// Coordenadas no viewBox 0..100 do mascote. Olhos centrados em (41,58) e (59,58).
export const EYE_Y = 57;
export const EYE_DX = 11;

type Shape = 'oval' | 'arc' | 'line' | 'smile' | 'spiral' | 'flat' | 'half';

interface Oval {
  dx: number;
  dy: number;
  rx: number;
  ry: number;
}

const OVAL: Partial<Record<MascotState, Oval>> = {
  idle: { dx: 0, dy: 0, rx: 2.2, ry: 3.8 },
  looking: { dx: 0, dy: 0, rx: 2.2, ry: 3.8 },
  thinking: { dx: 2.8, dy: -3.2, rx: 2.2, ry: 3.6 },
  attention: { dx: 0, dy: -0.5, rx: 3, ry: 5 },
  sad: { dx: 0, dy: 1.6, rx: 2.3, ry: 3.4 },
  listening: { dx: 0, dy: -0.4, rx: 3, ry: 4.9 },
};

function shapeFor(state: MascotState): Shape {
  switch (state) {
    case 'happy':
    case 'celebrating':
    case 'dancing':
      return 'arc';
    case 'sleepy':
    case 'shh':
      return 'line';
    case 'eating':
      return 'smile';
    case 'dizzy':
      return 'spiral';
    case 'working':
      return 'flat';
    case 'tired':
      return 'half';
    default:
      return 'oval';
  }
}

// Espiral de Arquimedes (olhos tontos).
const SPIRAL = (() => {
  const pts: string[] = [];
  const turns = 2.25;
  const maxR = 3.6;
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns * Math.PI * 2;
    const r = (i / steps) * maxR;
    pts.push(`${(Math.cos(th) * r).toFixed(2)} ${(Math.sin(th) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
})();

function useBlink(enabled: boolean, mood: number): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      // Humor alto pisca com mais frequência (seção 6.3).
      const base = mood >= 80 ? 1500 : mood < 40 ? 3000 : 2000;
      t = setTimeout(() => {
        setClosed(true);
        setTimeout(() => setClosed(false), 120);
        schedule();
      }, base + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(t);
  }, [enabled, mood]);
  return closed;
}

interface EyesProps {
  state: MascotState;
  mood: number;
  look: { x: number; y: number } | null;
  blink: boolean;
}

export function Eyes({ state, mood, look, blink }: EyesProps): React.JSX.Element {
  const shape = shapeFor(state);
  const closed = useBlink(blink && shape === 'oval', mood);
  const oval = OVAL[state] ?? OVAL.idle!;
  const lookDx = look ? look.x * 3 : 0;
  const lookDy = look ? look.y * 2 : 0;

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.g
        key={shape}
        initial={{ opacity: 0, scaleY: 0.2 }}
        animate={{ opacity: 1, scaleY: 1 }}
        exit={{ opacity: 0, scaleY: 0.2 }}
        transition={{ duration: 0.18 }}
        style={{ transformOrigin: `50px ${EYE_Y}px` }}
      >
        {[-1, 1].map((side) => {
          const cx = 50 + side * EYE_DX;
          if (shape === 'oval') {
            return (
              <motion.ellipse
                key={side}
                fill="#0A0A0B"
                initial={false}
                animate={{
                  cx: cx + oval.dx + lookDx,
                  cy: EYE_Y + oval.dy + lookDy,
                  rx: oval.rx,
                  ry: closed ? 0.35 : oval.ry,
                }}
                transition={{ duration: closed ? 0.06 : 0.18, ease: 'easeOut' }}
              />
            );
          }
          if (shape === 'arc') {
            return <path key={side} d={`M${cx - 3.4} ${EYE_Y + 1.6} Q${cx} ${EYE_Y - 4.2} ${cx + 3.4} ${EYE_Y + 1.6}`} stroke="#0A0A0B" strokeWidth={2.2} fill="none" strokeLinecap="round" />;
          }
          if (shape === 'smile') {
            return <path key={side} d={`M${cx - 3.4} ${EYE_Y - 1} Q${cx} ${EYE_Y + 3.8} ${cx + 3.4} ${EYE_Y - 1}`} stroke="#0A0A0B" strokeWidth={2.2} fill="none" strokeLinecap="round" />;
          }
          if (shape === 'line') {
            return <path key={side} d={`M${cx - 3.2} ${EYE_Y + 0.5} L${cx + 3.2} ${EYE_Y + 0.5}`} stroke="#0A0A0B" strokeWidth={2.2} strokeLinecap="round" />;
          }
          if (shape === 'spiral') {
            return (
              <motion.g key={side} animate={{ rotate: side * 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: `${cx}px ${EYE_Y}px` }}>
                <path d={SPIRAL} transform={`translate(${cx} ${EYE_Y})`} stroke="#0A0A0B" strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </motion.g>
            );
          }
          if (shape === 'flat') {
            // Olhar concentrado, levemente para baixo (no teclado).
            return <path key={side} d={`M${cx - 2.7} ${EYE_Y} L${cx + 2.7} ${EYE_Y} A2.7 3 0 0 1 ${cx - 2.7} ${EYE_Y} Z`} fill="#0A0A0B" />;
          }
          // half: semicerrados (cansado)
          return <path key={side} d={`M${cx - 2.8} ${EYE_Y + 1} L${cx + 2.8} ${EYE_Y + 1} A2.8 2.3 0 0 1 ${cx - 2.8} ${EYE_Y + 1} Z`} fill="#0A0A0B" />;
        })}
        {state === 'sad' && (
          <g stroke="#0A0A0B" strokeWidth={1.3} strokeLinecap="round" opacity={0.75}>
            <path d={`M${50 - EYE_DX - 3} ${EYE_Y - 7} L${50 - EYE_DX + 2.5} ${EYE_Y - 8.6}`} />
            <path d={`M${50 + EYE_DX + 3} ${EYE_Y - 7} L${50 + EYE_DX - 2.5} ${EYE_Y - 8.6}`} />
          </g>
        )}
      </motion.g>
    </AnimatePresence>
  );
}
