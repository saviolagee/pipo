import { fmtDay, summarize } from '@shared/trail';
import { IconCheck, IconPlus } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { useGoals, useToday } from '../store/goals';
import { useUi } from '../store/ui';
import { completeAction } from './actions';

const tt = t.trail;
const MAX = 3;

/** No Início: a ação da vez de cada plano ativo. É o centro do dia, no lugar das horas. */
export function TodayActions(): React.JSX.Element {
  const goals = useGoals((s) => s.list);
  const today = useToday();
  const active = goals.filter((g) => g.status === 'active');
  const open = (id: number | null): void => {
    useGoals.getState().select(id);
    useUi.getState().setTab('trail');
  };

  if (!active.length)
    return (
      <button type="button" onClick={() => open(null)} className="mt-[8px] flex h-[32px] w-full items-center gap-[8px] rounded-[12px] px-[12px] text-[12px] text-fg-3 transition-colors hover:bg-white/[0.05] hover:text-fg" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
        <IconPlus size={10} /> {tt.homeCreate}
      </button>
    );

  return (
    <div className="mt-[8px] flex flex-col gap-[4px]">
      {active.slice(0, MAX).map((g) => {
        const s = summarize(g, today);
        const a = s.current;
        return (
          <div key={g.id} className="relative flex h-[34px] items-center gap-[10px] overflow-hidden rounded-[12px] px-[10px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            {/* Quanto do plano já foi andado, num fio na base da linha. */}
            <span aria-hidden className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%`, background: 'linear-gradient(90deg, rgba(34,197,94,0.15), #22C55E)', transition: 'width 500ms var(--ease-out)' }} />
            <button
              type="button"
              disabled={!a}
              aria-label={a ? `${tt.complete}: ${a.title}` : tt.finished}
              title={a ? tt.complete : undefined}
              onClick={() => a && void completeAction(a)}
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-transparent transition-colors hover:text-white/70"
              style={{ boxShadow: `inset 0 0 0 1.5px ${s.dueToday ? '#60A5FA' : 'rgba(255,255,255,0.25)'}` }}
            >
              <IconCheck size={10} strokeWidth={3} />
            </button>
            <button type="button" onClick={() => open(g.id)} className="flex min-w-0 flex-1 items-baseline gap-[8px] text-left" title={a ? a.title : g.title}>
              <span className={`truncate text-[13px] ${s.dueToday ? 'text-fg' : 'text-fg-2'}`}>{a ? a.title : g.title}</span>
              {a && <span className="shrink-0 text-[11px]" style={{ color: s.dueToday ? '#60A5FA' : 'var(--text-muted)' }}>{s.dueToday ? tt.homeToday : fmtDay(a.day, today)}</span>}
            </button>
            <button type="button" onClick={() => open(g.id)} title={s.endDay ? `${g.title} · ${tt.ends(fmtDay(s.endDay, today))}` : g.title} className="flex shrink-0 items-baseline gap-[6px] text-[11px] text-fg-3 hover:text-fg">
              <span className="max-w-[170px] truncate">{g.title}</span>
              <span className="mono">
                {s.done}/{s.total}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
