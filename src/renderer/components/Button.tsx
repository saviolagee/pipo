import type { ButtonHTMLAttributes } from 'react';
import { Kbd } from './Kbd';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost';
  kbd?: string;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', kbd, size = 'md', className = '', children, ...rest }: Props): React.JSX.Element {
  const pad = size === 'sm' ? 'h-[26px] px-3 text-[12px]' : 'h-[30px] px-[14px] text-[13px]';
  // O principal é a pílula branca com um brilho em volta; o secundário é vidro com um fio de luz no topo.
  const styles: Record<NonNullable<Props['variant']>, string> = {
    primary: 'bg-white text-black hover:bg-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_4px_16px_rgba(255,255,255,0.10)]',
    secondary: 'bg-white/[0.08] text-fg hover:bg-white/[0.13] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    tertiary: 'bg-transparent text-fg-2 hover:text-fg hover:bg-white/[0.06]',
    ghost: 'bg-transparent text-fg-2 hover:text-fg',
  };
  return (
    <button
      type="button"
      className={`pipo-btn inline-flex shrink-0 items-center justify-center gap-[7px] rounded-full font-medium disabled:opacity-40 disabled:shadow-none ${pad} ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
      {kbd && <Kbd dark={variant === 'primary'}>{kbd}</Kbd>}
    </button>
  );
}
