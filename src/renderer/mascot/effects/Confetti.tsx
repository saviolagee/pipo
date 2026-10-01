import { motion } from 'motion/react';
import { useMemo } from 'react';

const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#D9468F', '#FFFFFF', '#A78BFA'];

/** Explosão de confete a partir do centro do container. Remonta a cada `burst`. */
export function Confetti({ burst, count }: { burst: number; count: number }): React.JSX.Element | null {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
        const speed = 50 + Math.random() * 70;
        return {
          i,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          rot: (Math.random() - 0.5) * 720,
          color: COLORS[i % COLORS.length],
          w: 4 + Math.random() * 3,
          h: 2 + Math.random() * 3,
          delay: Math.random() * 0.06,
        };
      }),
    [burst, count],
  );
  if (!burst) return null;
  return (
    <div key={burst} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {parts.map((p) => (
        <motion.span
          key={p.i}
          className="absolute block rounded-[1px]"
          style={{ width: p.w, height: p.h, background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: [0, p.dx, p.dx * 1.15], y: [0, p.dy, p.dy + 70], opacity: [1, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.15, delay: p.delay, times: [0, 0.4, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
