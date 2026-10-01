// Mini-Pipo colorido da pill (seção 3 do plano V2): apagado, aceso, esperando você, erro, concluiu e rascunho.
import { motion } from 'motion/react';
import type { PipoLiveState } from '@shared/pipos';

interface Props {
  color: string;
  state: PipoLiveState;
  /** Corpo em px (o mini da pill tem 12px de altura). */
  size?: number;
  title?: string;
  /** Pipo recém-contratado: cai na pill com um quique. */
  arriving?: boolean;
  /** Pipo que acabou de receber uma entrega de outro: acende por um instante. */
  flash?: boolean;
}

export function MiniPipo({ color, state, size = 16, title, arriving = false, flash = false }: Props): React.JSX.Element {
  const w = size;
  const h = size * 0.75;
  const lit = state === 'working' || state === 'waiting' || state === 'done' || flash;
  const draft = state === 'draft';
  const eyesOpen = lit;

  return (
    <motion.span
      role="img"
      aria-label={title}
      title={title}
      className="relative inline-flex items-center justify-center"
      style={{ width: w + 4, height: h + 6 }}
      initial={arriving ? { y: -22, opacity: 0 } : false}
      animate={
        state === 'done'
          ? { y: [0, -5, 0, 0], scaleY: [1, 1.12, 0.9, 1], opacity: 1 }
          : state === 'working'
            ? { y: [0, -1, 0], opacity: 1 }
            : { y: 0, opacity: 1 }
      }
      transition={
        arriving
          ? { type: 'spring', stiffness: 380, damping: 11 }
          : state === 'done'
            ? { duration: 0.6, times: [0, 0.35, 0.7, 1] }
            : state === 'working'
              ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.3 }
      }
    >
      <motion.svg
        width={w}
        height={h}
        viewBox="0 0 32 24"
        style={{ overflow: 'visible' }}
        initial={false}
        animate={{
          filter: lit ? `drop-shadow(0 0 ${state === 'done' ? 6 : 3.5}px ${color})` : 'drop-shadow(0 0 0px rgba(0,0,0,0))',
          opacity: state === 'idle' ? 0.32 : state === 'error' ? 0.55 : 1,
        }}
        transition={state === 'waiting' ? { opacity: { duration: 0.3 }, filter: { duration: 1.6, repeat: Infinity, repeatType: 'reverse' } } : { duration: 0.6 }}
      >
        {draft ? (
          <rect x={1} y={1} width={30} height={22} rx={8} fill={`${color}33`} stroke={color} strokeWidth={1.6} strokeDasharray="3 2.4" />
        ) : (
          <rect x={0} y={0} width={32} height={24} rx={8.5} fill={color} />
        )}
        {eyesOpen ? (
          <motion.g fill="#0A0A0B" animate={state === 'working' ? { x: [-1.2, 1.2, -1.2] } : { x: 0 }} transition={{ duration: 2.4, repeat: state === 'working' ? Infinity : 0, ease: 'easeInOut' }}>
            <motion.ellipse cx={10.5} cy={12.5} rx={2.2} animate={{ ry: [3.4, 3.4, 0.4, 3.4] }} transition={{ duration: 3.2, times: [0, 0.9, 0.95, 1], repeat: Infinity }} />
            <motion.ellipse cx={21.5} cy={12.5} rx={2.2} animate={{ ry: [3.4, 3.4, 0.4, 3.4] }} transition={{ duration: 3.2, times: [0, 0.9, 0.95, 1], repeat: Infinity }} />
          </motion.g>
        ) : (
          <g stroke={draft ? color : '#0A0A0B'} strokeWidth={1.8} strokeLinecap="round">
            <path d="M8 13 h5" />
            <path d="M19 13 h5" />
          </g>
        )}
      </motion.svg>
      {state === 'waiting' && (
        <motion.span className="absolute -right-[1px] -top-[1px] h-[5px] w-[5px] rounded-full bg-white" animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.6, repeat: Infinity }} style={{ boxShadow: '0 0 0 1.2px #000' }} />
      )}
      {state === 'error' && <span className="absolute -right-[1px] -top-[1px] h-[5px] w-[5px] rounded-full" style={{ background: '#EF4444', boxShadow: '0 0 0 1.2px #000' }} />}
    </motion.span>
  );
}
