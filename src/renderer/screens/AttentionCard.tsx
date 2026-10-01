import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Accessory, Card } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { cardTint } from '../notch/Glow';
import { useUi } from '../store/ui';

const DOT: Record<string, string> = {
  attention: '#F59E0B',
  done: '#22C55E',
  dizzy: '#D9468F',
  focus: '#3B82F6',
  none: '#F4F4F5',
};

export function respondCard(card: Card, buttonId: string): void {
  useUi.getState().dropCard(card.id);
  if (!card.id.startsWith('local:')) void api.invoke('cards:respond', card.id, buttonId);
  localHandlers.get(card.id)?.(buttonId);
  localHandlers.delete(card.id);
}

/** Campo seguro: o valor vai direto para o cofre do Pipo (main), nunca para o chat/agente. */
function SecretField({ card }: { card: Card }): React.JSX.Element {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (!value.trim()) return;
    setBusy(true);
    const ok = await api.invoke('pipos:submitSecret', card.id, value);
    setValue('');
    setBusy(false);
    if (ok) useUi.getState().dropCard(card.id);
  };
  return (
    <div className="mt-[8px] flex items-center gap-[6px]">
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        onFocus={() => useUi.getState().pin('secret', true)}
        onBlur={() => useUi.getState().pin('secret', false)}
        placeholder={t.team.secretPlaceholder}
        aria-label={card.secret?.name}
        autoComplete="off"
        spellCheck={false}
        className="mono h-[30px] min-w-0 flex-1 rounded-[8px] px-[10px] text-[12px] text-fg outline-none placeholder:text-fg-3"
        style={{ background: 'var(--bg-input)' }}
      />
      <Button size="sm" variant="primary" disabled={!value.trim() || busy} onClick={() => void save()}>
        {t.team.secretSave}
      </Button>
    </div>
  );
}

/** Cards criados no próprio renderer (tonto, ações locais) registram o callback aqui. */
export const localHandlers = new Map<string, (buttonId: string) => void>();

/**
 * Card de atenção / concluído / tonto [Ref 4, 6, 11].
 * `● Pipo` + tipo em cinza · caixa mono com o assunto · botões com kbd. Y e N ficam ativos.
 */
export function AttentionCard({ card, mood, accessories }: { card: Card; mood: number; accessories: Accessory[] }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const key = e.key.toUpperCase();
      const btn = card.buttons.find((b) => b.kbd === key);
      if (btn) {
        e.preventDefault();
        respondCard(card, btn.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card]);

  useEffect(() => {
    if (!card.autoDismissMs) return;
    const id = setTimeout(() => respondCard(card, 'timeout'), card.autoDismissMs);
    return () => clearTimeout(id);
  }, [card]);

  const badge = card.mascot === 'attention' ? 'attention' : card.glow === 'done' ? 'done' : null;
  const big = !!card.title;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="mx-[10px] mb-[10px] flex items-center gap-[16px] overflow-hidden rounded-[16px] px-[16px] py-[14px]"
      style={{ ...cardTint(card.glow), border: '1px solid var(--border-subtle)' }}
      role="alertdialog"
      aria-label={card.label}
    >
      <div className="flex w-[84px] shrink-0 items-center justify-center">
        <Mascot state={card.mascot} badge={badge} mood={mood} accessories={card.pipoColor ? [] : accessories} size={72} color={card.pipoColor} />
      </div>
      <div className="min-w-0 flex-1">
        {card.label && (
          <div className="flex items-center gap-[6px] text-[12px]">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: DOT[card.glow] }} />
            <span className="font-semibold text-fg">Pipo</span>
            <span className="text-fg-2">{card.label}</span>
          </div>
        )}
        {card.subject && (
          <div className="mono mt-[8px] truncate rounded-[8px] px-[12px] py-[7px] text-[12.5px] text-fg" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {card.subject}
          </div>
        )}
        {big && <div className="mt-[6px] text-[15px] first:mt-0 font-semibold leading-snug text-fg">{card.title}</div>}
        {card.list && card.list.length > 0 && (
          <div className="scroll-thin mt-[8px] flex max-h-[148px] flex-col gap-[3px] overflow-y-auto pr-[4px]">
            {card.list.map((item, i) => (
              <div key={i} className="rounded-[8px] px-[10px] py-[5px]" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="truncate text-[12.5px] text-fg">{item.title}</div>
                {item.detail && <div className="mono truncate text-[11px] text-fg-3">{item.detail}</div>}
              </div>
            ))}
          </div>
        )}
        {card.body && <div className={`${big ? 'mt-[2px]' : 'mt-[4px]'} whitespace-pre-line text-[12px] text-fg-2`}>{card.body}</div>}
        {card.secret && <SecretField card={card} />}
        {card.buttons.length > 0 && (
          <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
            {card.buttons.map((b) => (
              <Button key={b.id} size="sm" variant={b.variant} kbd={b.kbd} onClick={() => respondCard(card, b.id)}>
                {b.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
