import { motion } from 'motion/react';

/** Anel de progresso da meta do dia (horas trabalhadas vs. meta). */
export function GoalRing({ progress, size = 18, title }: { progress: number; size?: number; title?: string }): React.JSX.Element {
  const p = Math.max(0, Math.min(1, progress));
  const stroke = 2.4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = progress >= 1.25 ? 'var(--status-attention)' : progress >= 1 ? 'var(--status-done)' : '#FFFFFF';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - p) }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
