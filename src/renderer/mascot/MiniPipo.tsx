// Mini-Pipo colorido da pill (seção 3 do plano V2): a mesma bola do mascote, bem pequena. Apagado,
// aceso, esperando você, erro, concluiu e rascunho.
import { motion } from 'motion/react';
import type { PipoLiveState } from '@shared/pipos';

interface Props {
  color: string;
  state: PipoLiveState;
  /** Diâmetro do espaço em px (a bola ocupa uns 85%). */
  size?: number;
  title?: string;
  /** Pipo recém-contratado: cai na pill com um quique. */
  arriving?: boolean;
  /** Pipo que acabou de receber uma entrega de outro: acende por um instante. */
  flash?: boolean;
}

export function MiniPipo({ color, state, size = 16, title, arriving = false, flash = false }: Props): React.JSX.Element {
  const w = size * 0.86;
  const h = w;
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
        viewBox="0 0 24 24"
        style={{ overflow: 'visible' }}
        initial={false}
        animate={{
          filter: lit ? `drop-shadow(0 0 ${state === 'done' ? 6 : 3.5}px ${color})` : 'drop-shadow(0 0 0px rgba(0,0,0,0))',
          opacity: state === 'idle' ? 0.32 : state === 'error' ? 0.55 : 1,
        }}
        transition={state === 'waiting' ? { opacity: { duration: 0.3 }, filter: { duration: 1.6, repeat: Infinity, repeatType: 'reverse' } } : { duration: 0.6 }}
      >
        {draft ? <circle cx={12} cy={12} r={10.6} fill={`${color}33`} stroke={color} strokeWidth={1.6} strokeDasharray="3 2.4" /> : <circle cx={12} cy={12} r={11.4} fill={color} />}
        {eyesOpen ? (
          // Aceso: olhos de meia-lua, olhando de um lado para o outro enquanto trabalha.
          <motion.g fill="#0A0A0B" animate={state === 'working' ? { x: [-0.9, 0.9, -0.9] } : { x: 0 }} transition={{ duration: 2.4, repeat: state === 'working' ? Infinity : 0, ease: 'easeInOut' }}>
            <path d="M4.6 8.8 L11 10.6 Q8.6 14.4 5.6 12 Z" />
            <path d="M13 10.6 L19.4 9.4 Q18.8 13.4 15 13.2 Z" />
          </motion.g>
        ) : (
          <g stroke={draft ? color : '#0A0A0B'} strokeWidth={1.7} strokeLinecap="round">
            <path d="M5.4 10 L10.6 11.2" />
            <path d="M13.4 11.2 L18.6 10" />
          </g>
        )}
        <path d="M7.6 16.6 H16.4" stroke={draft ? color : '#0A0A0B'} strokeWidth={1.5} strokeLinecap="round" />
      </motion.svg>
      {state === 'waiting' && (
        <motion.span className="absolute -right-[1px] -top-[1px] h-[5px] w-[5px] rounded-full bg-white" animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.6, repeat: Infinity }} style={{ boxShadow: '0 0 0 1.2px #000' }} />
      )}
      {state === 'error' && <span className="absolute -right-[1px] -top-[1px] h-[5px] w-[5px] rounded-full" style={{ background: '#EF4444', boxShadow: '0 0 0 1.2px #000' }} />}
    </motion.span>
  );
}
