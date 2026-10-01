import { motion } from 'motion/react';
import type { GlowKind } from '@shared/types';

export const GLOW_RGB: Record<Exclude<GlowKind, 'none'>, string> = {
  focus: '59,130,246',
  attention: '245,158,11',
  done: '34,197,94',
  dizzy: '217,70,143',
};

const SPRING = { type: 'spring', stiffness: 400, damping: 32 } as const;
/** Quanto a luz vaza abaixo da ilha (px). Fixo: não cresce com a altura do notch. */
const SPILL = 84;
/** Quanto da luz fica escondido atrás da borda de baixo (dá a sensação de sair de dentro da ilha). */
const TUCK = 26;

/**
 * Glow de estado saindo de baixo do notch (seção 5.2). Ancorado na borda de baixo da ilha, com
 * vazamento fixo: com o notch expandido a luz continua colada embaixo dele, nunca no meio da tela.
 * Expandido, um halo fraco contorna as laterais.
 */
export function Glow({ kind, width, height, expanded = false }: { kind: GlowKind; width: number; height: number; expanded?: boolean }): React.JSX.Element {
  const rgb = kind === 'none' ? '0,0,0' : GLOW_RGB[kind];
  const on = kind !== 'none';
  return (
    <>
      <motion.div
        aria-hidden
        data-glow="bottom"
        className="pointer-events-none absolute left-1/2"
        initial={false}
        animate={{ opacity: on ? 0.55 : 0, top: height - TUCK, width: width * 0.92 + 40, height: SPILL + TUCK }}
        transition={{ opacity: { duration: 0.4 }, top: SPRING, width: SPRING, height: SPRING }}
        style={{
          x: '-50%',
          background: `radial-gradient(ellipse 50% 48% at 50% 30%, rgba(${rgb},1), rgba(${rgb},0.35) 45%, rgba(${rgb},0) 100%)`,
          filter: 'blur(22px)',
          transition: 'background 400ms ease',
        }}
      />
      <motion.div
        aria-hidden
        data-glow="halo"
        className="pointer-events-none absolute left-1/2 top-0"
        initial={false}
        animate={{ opacity: on && expanded ? 1 : 0, width, height }}
        transition={{ opacity: { duration: 0.4 }, width: SPRING, height: SPRING }}
        style={{
          x: '-50%',
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
          boxShadow: `0 6px 28px 2px rgba(${rgb},0.22)`,
          transition: 'box-shadow 400ms ease',
        }}
      />
    </>
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
