import type { ButtonHTMLAttributes } from 'react';
import { Kbd } from './Kbd';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost';
  kbd?: string;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', kbd, size = 'md', className = '', children, ...rest }: Props): React.JSX.Element {
  const pad = size === 'sm' ? 'h-[26px] px-3 text-[12px]' : 'h-[30px] px-[14px] text-[13px]';
  const styles: Record<NonNullable<Props['variant']>, string> = {
    primary: 'bg-white text-black hover:bg-white/90',
    secondary: 'bg-white/[0.08] text-fg hover:bg-white/[0.12]',
    tertiary: 'bg-transparent text-fg-2 hover:text-fg hover:bg-white/[0.05]',
    ghost: 'bg-transparent text-fg-2 hover:text-fg',
  };
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-[7px] rounded-full font-medium transition-colors duration-150 disabled:opacity-40 ${pad} ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
      {kbd && <Kbd dark={variant === 'primary'}>{kbd}</Kbd>}
    </button>
  );
}
