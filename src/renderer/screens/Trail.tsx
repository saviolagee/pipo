import { useEffect, useState } from 'react';
import { fmtDay, summarize } from '@shared/trail';
import { IconGear, IconPlus, IconSpark } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { useGoals, useToday } from '../store/goals';
import { askPipo } from '../trail/actions';
import { TrailPath } from '../trail/Path';
import { GoalSettings, NewPlan } from '../trail/PlanForms';

const tt = t.trail;

function HeadButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-[24px] items-center gap-[5px] rounded-full px-[8px] text-[11px] transition-colors ${active ? 'bg-white/[0.12] text-fg' : 'text-fg-3 hover:bg-white/[0.07] hover:text-fg'}`}>
      {children}
    </button>
  );
}

/** Aba Trilha: o plano desmembrado em ações por dia, com a de hoje em destaque. */
export function TrailScreen(): React.JSX.Element {
  const goals = useGoals((s) => s.list);
  const selectedId = useGoals((s) => s.selectedId);
  const select = useGoals((s) => s.select);
  const today = useToday();
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const goal = goals.find((g) => g.id === selectedId) ?? goals[0] ?? null;

  useEffect(() => {
    void useGoals.getState().load();
  }, []);
  useEffect(() => setSettings(false), [goal?.id]);

  if (!goal || creating)
    return (
      <div className="px-[10px] pb-[10px]">
        <NewPlan today={today} onClose={goal ? () => setCreating(false) : null} />
      </div>
    );

  const s = summarize(goal, today);
  return (
    <div className="px-[10px] pb-[10px]">
      <div className="mb-[8px] flex items-center gap-[6px] px-[4px]">
        <div className="scroll-thin flex min-w-0 flex-1 items-center gap-[4px] overflow-x-auto">
          {goals.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.outcome || g.title}
              onClick={() => select(g.id)}
              className={`h-[24px] max-w-[200px] shrink-0 truncate rounded-full px-[10px] text-[12px] transition-colors ${g.id === goal.id ? 'bg-white text-black' : 'bg-white/[0.06] text-fg-2 hover:bg-white/[0.1] hover:text-fg'}`}
            >
              {g.title}
            </button>
          ))}
          <HeadButton label={tt.newPlan} onClick={() => setCreating(true)}>
            <IconPlus size={10} />
          </HeadButton>
        </div>
        <span className="shrink-0 text-[11.5px] text-fg-2" title={s.slipDays > 0 && goal.targetDate ? tt.slipHint(fmtDay(goal.targetDate, today)) : undefined}>
          <span className="mono text-fg">
            {s.done}/{s.total}
          </span>
          {goal.status === 'done' ? ` · ${tt.finished}` : s.endDay ? ` · ${tt.ends(fmtDay(s.endDay, today))}` : ''}
          {goal.status !== 'done' && s.slipDays > 0 && <span className="text-fg-3"> · {tt.slip(s.slipDays)}</span>}
        </span>
        <HeadButton label={tt.adjust} onClick={() => askPipo(tt.adjustPrompt(goal.title), false)}>
          <IconSpark size={11} /> Pipo
        </HeadButton>
        <HeadButton label={tt.settings} active={settings} onClick={() => setSettings((v) => !v)}>
          <IconGear size={13} />
        </HeadButton>
      </div>
      {settings ? <GoalSettings key={goal.id} goal={goal} today={today} onClose={() => setSettings(false)} /> : <TrailPath goal={goal} today={today} />}
    </div>
  );
}
