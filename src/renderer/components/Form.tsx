// Controles de formulário compartilhados entre onboarding e Configurações.
import { useState } from 'react';
import { useUi } from '../store/ui';
import { IconX } from './Icons';

/** Prende o notch aberto enquanto um campo de texto tem foco. */
export function usePinOnFocus(key: string): { onFocus: () => void; onBlur: () => void } {
  const pin = useUi((s) => s.pin);
  return { onFocus: () => pin(`input:${key}`, true), onBlur: () => pin(`input:${key}`, false) };
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div className="mb-[6px] flex items-baseline gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{children}</span>
      {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
    </div>
  );
}

export function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-[28px] items-center gap-[6px] rounded-[10px] px-[10px] text-[12px] transition-colors ${
        on ? 'bg-white text-black' : 'bg-[var(--bg-card-hover)] text-fg-2 hover:bg-white/[0.08] hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

export function Option({ on, onClick, title, desc, icon }: { on: boolean; onClick: () => void; title: string; desc?: string; icon?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex min-h-[44px] items-center gap-[10px] rounded-[12px] px-[12px] py-[8px] text-left transition-colors"
      style={{ background: on ? 'rgba(255,255,255,0.1)' : 'var(--bg-card-hover)', boxShadow: on ? 'inset 0 0 0 1.5px rgba(255,255,255,0.85)' : 'inset 0 0 0 1px var(--border-subtle)' }}
    >
      {icon && <span className="text-[16px]">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fg">{title}</span>
        {desc && <span className="block text-[11.5px] text-fg-2">{desc}</span>}
      </span>
    </button>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
  className = '',
  ariaLabel,
  pinKey = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  className?: string;
  ariaLabel?: string;
  pinKey?: string;
}): React.JSX.Element {
  const pin = usePinOnFocus(pinKey);
  return (
    <input
      value={value}
      aria-label={ariaLabel ?? placeholder}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      {...pin}
      className={`h-[32px] rounded-[10px] px-[12px] text-[13px] outline-none placeholder:text-fg-3 focus:ring-1 focus:ring-white/30 ${className}`}
      style={{ background: 'var(--bg-input)' }}
    />
  );
}

export function TimeField({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }): React.JSX.Element {
  const pin = usePinOnFocus(ariaLabel);
  return (
    <input
      type="time"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...pin}
      className="mono h-[30px] w-[92px] rounded-[10px] px-[10px] text-[13px] outline-none [color-scheme:dark] focus:ring-1 focus:ring-white/30"
      style={{ background: 'var(--bg-input)' }}
    />
  );
}

export function NumberField({ value, onChange, min, max, suffix, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string; ariaLabel: string }): React.JSX.Element {
  const pin = usePinOnFocus(ariaLabel);
  return (
    <span className="inline-flex items-center gap-[6px]">
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        {...pin}
        className="mono h-[30px] w-[64px] rounded-[10px] px-[10px] text-[13px] outline-none focus:ring-1 focus:ring-white/30"
        style={{ background: 'var(--bg-input)' }}
      />
      {suffix && <span className="text-[12px] text-fg-2">{suffix}</span>}
    </span>
  );
}

export function Slider({ value, onChange, min, max, step, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; ariaLabel: string }): React.JSX.Element {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="pipo-range w-full"
      style={{ '--pct': `${pct}%` } as React.CSSProperties}
    />
  );
}

export function YesNo({ value, onChange, yes = 'Sim', no = 'Não' }: { value: boolean; onChange: (v: boolean) => void; yes?: string; no?: string }): React.JSX.Element {
  return (
    <span className="inline-flex rounded-[10px] p-[2px]" style={{ background: 'var(--bg-card-hover)' }}>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`h-[26px] rounded-[8px] px-[12px] text-[12px] transition-colors ${value === v ? 'bg-white text-black' : 'text-fg-2 hover:text-fg'}`}
        >
          {v ? yes : no}
        </button>
      ))}
    </span>
  );
}

/** Lista de etiquetas com input para adicionar (palavras-chave, distrações). */
export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {values.map((v) => (
        <span key={v} className="inline-flex h-[24px] items-center gap-[4px] rounded-[8px] pl-[8px] pr-[4px] text-[12px] text-fg" style={{ background: 'var(--bg-card-hover)' }}>
          {v}
          <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-[2px] text-fg-3 hover:text-fg">
            <IconX size={10} />
          </button>
        </span>
      ))}
      <TextField value={draft} onChange={setDraft} placeholder={placeholder} onEnter={add} className="h-[26px] w-[150px] text-[12px]" pinKey="tag" />
    </div>
  );
}
