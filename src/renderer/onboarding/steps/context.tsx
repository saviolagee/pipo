import { useState } from 'react';
import { DEFAULT_DISTRACTIONS } from '@shared/config';
import type { DistractionSettings } from '@shared/types';
import { Button } from '../../components/Button';
import { Chip, Label, TagInput, TextField } from '../../components/Form';
import { IconX } from '../../components/Icons';
import { t } from '../../i18n/pt-BR';
import type { StepProps } from '../draft';

const o = t.onboarding;
const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#D9468F', '#A78BFA', '#14B8A6', '#F97316', '#EAB308'];

function slug(name: string): string[] {
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return [...new Set([n.replace(/[^a-z0-9]+/g, '-'), n.replace(/[^a-z0-9]+/g, '')])].filter((k) => k.length >= 3);
}

export function DistractionsStep({ draft, set }: StepProps): React.JSX.Element {
  const ds = draft.distractions;
  const all = [...new Set([...DEFAULT_DISTRACTIONS, ...ds.items])];
  const patch = (p: Partial<DistractionSettings>): void => set((d) => ({ ...d, distractions: { ...d.distractions, ...p } }));
  const toggle = (item: string): void => patch({ items: ds.items.includes(item) ? ds.items.filter((x) => x !== item) : [...ds.items, item] });
  const custom = ds.items.filter((x) => !(DEFAULT_DISTRACTIONS as readonly string[]).includes(x));
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap gap-[6px]">
        {all
          .filter((x) => (DEFAULT_DISTRACTIONS as readonly string[]).includes(x))
          .map((item) => (
            <Chip key={item} on={ds.items.includes(item)} onClick={() => toggle(item)}>
              {item}
            </Chip>
          ))}
      </div>
      <TagInput values={custom} onChange={(vals) => patch({ items: [...ds.items.filter((x) => (DEFAULT_DISTRACTIONS as readonly string[]).includes(x)), ...vals] })} placeholder={o.distractionsAdd} />
      <div className="flex items-center gap-[8px]">
        <span className="text-[12px] text-fg-2">{o.tolerance}</span>
        {([30, 60, 180] as const).map((s) => (
          <Chip key={s} on={ds.toleranceSec === s} onClick={() => patch({ toleranceSec: s })}>
            {o.toleranceOpts[s]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function ClientsStep({ draft, set }: StepProps): React.JSX.Element {
  const [name, setName] = useState('');
  const add = (): void => {
    const n = name.trim();
    if (!n) return;
    set((d) => ({ ...d, clients: [...d.clients, { name: n, keywords: slug(n), color: COLORS[d.clients.length % COLORS.length], archived: false }] }));
    setName('');
  };
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[8px]">
        <TextField value={name} onChange={setName} placeholder={o.clientName} onEnter={add} className="w-[240px]" pinKey="client" />
        <Button size="sm" onClick={add} disabled={!name.trim()}>
          {o.addClient}
        </Button>
      </div>
      <div className="scroll-thin flex max-h-[150px] flex-col gap-[6px] overflow-y-auto pr-1">
        {draft.clients.map((c, i) => (
          <div key={c.id ?? `n${i}`} className="flex items-start gap-[8px] rounded-[10px] px-[10px] py-[6px]" style={{ background: 'var(--bg-card-hover)' }}>
            <span className="mt-[7px] h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: c.color }} />
            <div className="min-w-0 flex-1">
              <div className="mb-[4px] text-[13px] font-medium">{c.name}</div>
              <TagInput values={c.keywords} onChange={(keywords) => set((d) => ({ ...d, clients: d.clients.map((x, j) => (j === i ? { ...x, keywords } : x)) }))} placeholder={`+ ${o.clientKeywords}`} />
            </div>
            <button type="button" aria-label={`${t.common.remove} ${c.name}`} onClick={() => set((d) => ({ ...d, clients: d.clients.filter((_, j) => j !== i) }))} className="mt-[4px] text-fg-3 hover:text-fg">
              <IconX size={11} />
            </button>
          </div>
        ))}
      </div>
      {draft.clients.length === 0 && <Label>{o.clientsHint}</Label>}
    </div>
  );
}
