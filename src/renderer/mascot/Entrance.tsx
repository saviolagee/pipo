import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Mascot } from './Mascot';

const GHOSTS = 7;
const FLIGHT = 0.95;

/** Entrada [Ref 2]: voa da esquerda com rastro, pousa com squash, pisca e entra em idle (~1.2s). */
export function Entrance({ size, onDone }: { size: number; onDone: () => void }): React.JSX.Element {
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setLanded(true), FLIGHT * 1000);
    const b = setTimeout(onDone, 1250);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [onDone]);

  const path = {
    x: [-360, -170, -40, 0],
    y: [30, -18, -6, 0],
    rotate: [-28, -18, -6, 0],
  };

  return (
    <div className="relative">
      {!landed &&
        Array.from({ length: GHOSTS }, (_, i) => (
          <motion.div
            key={i}
            className="absolute inset-0"
            initial={{ x: -360, y: 30, rotate: -28, opacity: 0 }}
            animate={{ ...path, opacity: [0, 0.5 - i * 0.06, 0.4 - i * 0.05, 0] }}
            transition={{ duration: FLIGHT, delay: (i + 1) * 0.035, ease: [0.22, 0.8, 0.3, 1] }}
            style={{ filter: `blur(${1 + i * 0.9}px)` }}
          >
            <Mascot state="happy" size={size} still glow={false} />
          </motion.div>
        ))}
      <motion.div
        initial={{ x: -360, y: 30, rotate: -28 }}
        animate={landed ? { x: 0, y: 0, rotate: 0, scaleX: [1.14, 0.96, 1], scaleY: [0.86, 1.04, 1] } : path}
        transition={landed ? { duration: 0.3, ease: 'easeOut' } : { duration: FLIGHT, ease: [0.22, 0.8, 0.3, 1] }}
        style={{ transformOrigin: '50% 80%' }}
      >
        <Mascot state={landed ? 'idle' : 'happy'} size={size} hands={landed ? null : 'open'} still={!landed} />
      </motion.div>
    </div>
  );
}
