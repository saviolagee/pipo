import { motion } from 'motion/react';
import type { GlowKind } from '@shared/types';

export const GLOW_RGB: Record<Exclude<GlowKind, 'none'>, string> = {
  focus: '59,130,246',
  attention: '245,158,11',
  done: '34,197,94',
  dizzy: '217,70,143',
};

/** Glow de estado atrás do notch, vazando para fora da ilha (seção 5.2). */
export function Glow({ kind, width, height }: { kind: GlowKind; width: number; height: number }): React.JSX.Element {
  const rgb = kind === 'none' ? '0,0,0' : GLOW_RGB[kind];
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0"
      initial={false}
      animate={{ opacity: kind === 'none' ? 0 : 0.35, width: width + 140, height: height + 150 }}
      transition={{ opacity: { duration: 0.4 }, width: { type: 'spring', stiffness: 400, damping: 32 }, height: { type: 'spring', stiffness: 400, damping: 32 } }}
      style={{
        x: '-50%',
        background: `radial-gradient(ellipse 48% 42% at 50% 72%, rgba(${rgb},1), rgba(${rgb},0) 100%)`,
        filter: 'blur(40px)',
        transition: 'background 400ms ease',
      }}
    />
  );
}

/** Tinta do glow dentro de um card ativo [Ref 4, 6, 11]. */
export function cardTint(kind: GlowKind): React.CSSProperties {
  if (kind === 'none') return { background: 'var(--bg-card)' };
  const rgb = GLOW_RGB[kind];
  return {
    background: `radial-gradient(120% 140% at 85% 120%, rgba(${rgb},0.42) 0%, rgba(${rgb},0.12) 45%, rgba(${rgb},0) 75%), var(--bg-card)`,
    transition: 'background 400ms ease',
  };
}
