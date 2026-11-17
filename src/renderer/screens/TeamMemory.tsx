// "O que a equipe sabe": fatos sobre o usuário e o negócio que o Pipo branco e todos os coloridos
// usam. Eles aprendem no chat (remember_fact); aqui dá para ver, escrever e apagar.
import { useEffect, useState } from 'react';
import type { TeamFact } from '@shared/team';
import { usePinOnFocus } from '../components/Form';
import { IconChevron, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';

const tt = t.team;

export function TeamMemory(): React.JSX.Element {
  const [facts, setFacts] = useState<TeamFact[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const pin = usePinOnFocus('team-memory');
  useEffect(() => {
    void api.invoke('team:facts').then(setFacts);
    // Um Pipo pode ter aprendido algo enquanto a tela estava aberta.
    return api.on('toast:show', (toast) => {
      if (toast.id.startsWith('fact:')) void api.invoke('team:facts').then(setFacts);
    });
  }, []);
  return (
    <div className="mt-[10px] rounded-[12px] px-[10px] py-[8px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-[6px] text-left">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-fg-3">
          {tt.teamMemory} ({facts.length})
        </span>
        <span className="flex-1" />
        <span className="text-fg-3">
          <IconChevron size={8} dir={open ? 'up' : 'down'} />
        </span>
      </button>
      {open && (
        <div className="mt-[6px] flex flex-col gap-[3px]">
          <p className="text-[11px] leading-[1.4] text-fg-3">{facts.length ? tt.teamMemoryHint : tt.teamMemoryEmpty}</p>
          {facts.map((f) => (
            <div key={f.id} className="group flex items-start gap-[6px] text-[12px] text-fg">
              <span className="mt-[1px] text-fg-3">•</span>
              <span className="min-w-0 flex-1 select-text">{f.text}</span>
              {f.source.startsWith('@') && <span className="mono shrink-0 text-[10px] text-fg-3">{f.source}</span>}
              <button type="button" aria-label={t.common.remove} className="mt-[3px] shrink-0 opacity-0 group-hover:opacity-100" onClick={() => void api.invoke('team:deleteFact', f.id).then(setFacts)}>
                <IconX size={9} />
              </button>
            </div>
          ))}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !text.trim()) return;
              void api.invoke('team:addFact', text.trim()).then(setFacts);
              setText('');
            }}
            {...pin}
            placeholder={tt.teamMemoryAdd}
            aria-label={tt.teamMemoryAdd}
            className="mt-[2px] rounded-[6px] bg-transparent px-[2px] py-[2px] text-[12px] text-fg outline-none placeholder:text-fg-3 focus:bg-white/[0.06]"
          />
        </div>
      )}
    </div>
  );
}
