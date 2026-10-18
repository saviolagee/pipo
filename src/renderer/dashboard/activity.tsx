// Peças dos dashboards de atividades: o calendário dos dias com atividade, a lista do que foi
// feito e o avanço dos planos da trilha.
import type { DashActivity, DashData, DashDay, DashRange } from '@shared/dashboard';
import { t } from '../i18n/pt-BR';
import { EMPTY_CELL, Hatch, INK, LegendSwatch, SEQ, SERIES, seqColor, Tooltip, useTip } from './charts';

const d = t.dash;
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number): string => String(n).padStart(2, '0');
const keyOf = (x: Date): string => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const ddmm = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
/** Cor das ações da trilha (as tarefas usam a cor do cliente). */
export const TRAIL_COLOR = SERIES[2];
const ABSENT = ['off', 'holiday', 'sick', 'vacation'];

/** Linhas do tooltip de um dia. */
export function dayTip(x: DashDay): string[] {
  return [
    `${WD[x.weekday]} ${ddmm(x.date)}${x.status ? ` · ${d.absenceLabel[x.status] ?? x.status}${x.statusNote ? ` (${x.statusNote})` : ''}` : ''}`,
    x.done ? d.doneLine(x.done, x.tasksDone, x.actionsDone) : d.nothingDone,
    ...(x.created ? [d.createdLine(x.created)] : []),
  ];
}

/** Semana ou mês em forma de calendário: cada dia mostra quantas atividades foram feitas. */
export function CalendarGrid({ range, days }: { range: DashRange; days: DashDay[] }): React.JSX.Element {
  const [tip, show, hide] = useTip();
  const by = new Map(days.map((x) => [x.date, x]));
  const today = keyOf(new Date());
  const all: string[] = [];
  for (let x = parse(range.from); keyOf(x) <= range.to; x.setDate(x.getDate() + 1)) all.push(keyOf(x));
  // A semana começa na segunda; no mês, os primeiros dias ficam na coluna certa.
  const lead = (parse(range.from).getDay() + 6) % 7;
  const max = Math.max(4, ...days.map((x) => x.done));
  const week = range.kind === 'week';
  return (
    <div className="relative">
      <div className="grid grid-cols-7 gap-[6px]">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => (
          <div key={w} className="text-center text-[10.5px]" style={{ color: INK.muted }}>
            {w}
          </div>
        ))}
        {Array.from({ length: week ? 0 : lead }, (_, i) => (
          <div key={`v${i}`} />
        ))}
        {all.map((k) => {
          const x = by.get(k);
          const future = k > today;
          const done = x?.done ?? 0;
          const fill = done > 0 ? seqColor(done, max) : EMPTY_CELL;
          // Os dois tons mais claros da escala pedem texto escuro.
          const ink = done > 0 && SEQ.indexOf(fill as (typeof SEQ)[number]) >= 3 ? '#0B1B33' : INK.primary;
          const absent = !!x?.status && ABSENT.includes(x.status) && done === 0;
          return (
            <div
              key={k}
              onMouseMove={(e) => x && show(e, dayTip(x))}
              onMouseLeave={hide}
              className={`relative flex flex-col justify-between overflow-hidden rounded-[10px] px-[8px] py-[6px] ${week ? 'h-[92px]' : 'h-[58px]'}`}
              style={{
                background: future ? 'transparent' : fill,
                border: future ? '1px dashed rgba(255,255,255,0.1)' : '1px solid transparent',
                boxShadow: k === today ? '0 0 0 1.5px rgba(255,255,255,0.85)' : undefined,
              }}
            >
              {absent && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                  <Hatch />
                  <rect width="100%" height="100%" fill={x?.status === 'vacation' ? SERIES[2] : SERIES[1]} opacity={0.22} />
                  <rect width="100%" height="100%" fill="url(#pipo-hatch)" />
                </svg>
              )}
              <span className="relative mono text-[10.5px]" style={{ color: future ? INK.muted : done > 0 ? ink : INK.secondary }}>
                {Number(k.slice(8, 10))}
              </span>
              {!future && (
                <span className={`relative mono font-semibold leading-none ${week ? 'text-[26px]' : 'text-[17px]'}`} style={{ color: done > 0 ? ink : INK.muted }}>
                  {done > 0 ? done : absent ? '' : '·'}
                </span>
              )}
              {week && !future && (
                <span className="relative truncate text-[10.5px]" style={{ color: done > 0 ? ink : INK.muted }}>
                  {absent ? (d.absenceLabel[x?.status ?? ''] ?? '') : done > 0 ? d.doneWord(done) : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-[10px] flex flex-wrap items-center gap-[12px] text-[11px]" style={{ color: INK.secondary }}>
        <span className="flex items-center gap-[4px]">
          {d.less}
          {[EMPTY_CELL, ...SEQ].map((c) => (
            <span key={c} className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: c }} />
          ))}
          {d.more} ({max}+)
        </span>
        <LegendSwatch color={SERIES[1]} label={d.absentLegend} hatch />
        <LegendSwatch color={SERIES[2]} label={d.absenceLabel.vacation} hatch />
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** O que foi feito, agrupado por dia (do mais novo para o mais antigo). */
export function ActivityList({ items, more, empty }: { items: DashActivity[]; more: number; empty: string }): React.JSX.Element {
  if (!items.length) return <p className="text-[12px]" style={{ color: INK.muted }}>{empty}</p>;
  const groups: Array<{ date: string; items: DashActivity[] }> = [];
  for (const a of items) {
    const g = groups[groups.length - 1];
    if (g && g.date === a.date) g.items.push(a);
    else groups.push({ date: a.date, items: [a] });
  }
  return (
    <div className="scroll-thin flex max-h-[380px] flex-col gap-[12px] overflow-y-auto pr-[4px]">
      {groups.map((g) => (
        <div key={g.date}>
          <div className="mb-[4px] flex items-baseline gap-[8px] text-[11.5px]" style={{ color: INK.secondary }}>
            <span className="font-medium" style={{ color: INK.primary }}>
              {WD[parse(g.date).getDay()]} {ddmm(g.date)}
            </span>
            <span>{d.doneWord(g.items.length)}</span>
          </div>
          {g.items.map((a, i) => (
            <div key={`${a.at}-${i}`} className="flex h-[26px] items-center gap-[8px] text-[12.5px]">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: a.kind === 'action' ? TRAIL_COLOR : (a.color ?? INK.muted) }} />
              <span className="min-w-0 flex-1 truncate" style={{ color: INK.primary }} title={a.title}>
                {a.title}
              </span>
              {a.where && (
                <span className="max-w-[180px] shrink-0 truncate text-[11px]" style={{ color: INK.muted }} title={a.where}>
                  {a.kind === 'action' ? `${d.trailTag} · ${a.where}` : a.where}
                </span>
              )}
              <span className="mono shrink-0 text-[11px]" style={{ color: INK.muted }}>
                {new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      ))}
      {more > 0 && <p className="text-[11.5px]" style={{ color: INK.muted }}>{d.moreActivities(more)}</p>}
    </div>
  );
}

/** Avanço de cada plano da trilha, com o que andou no período em destaque. */
export function GoalsProgress({ goals }: { goals: DashData['goals'] }): React.JSX.Element {
  if (!goals.length) return <p className="text-[12px]" style={{ color: INK.muted }}>{d.noGoals}</p>;
  return (
    <div className="flex flex-col gap-[10px]">
      {goals.map((g) => {
        const before = g.total ? ((g.done - g.doneInRange) / g.total) * 100 : 0;
        const now = g.total ? (g.doneInRange / g.total) * 100 : 0;
        return (
          <div key={g.id}>
            <div className="mb-[4px] flex items-baseline gap-[8px] text-[12.5px]">
              <span className="min-w-0 flex-1 truncate" style={{ color: INK.primary }} title={g.title}>
                {g.title}
              </span>
              {g.doneInRange > 0 && <span className="text-[11px]" style={{ color: TRAIL_COLOR }}>{d.goalAdvanced(g.doneInRange)}</span>}
              <span className="mono text-[11.5px]" style={{ color: INK.secondary }}>
                {g.done}/{g.total}
              </span>
            </div>
            <div className="flex h-[8px] w-full overflow-hidden rounded-full" style={{ background: EMPTY_CELL }}>
              <span style={{ width: `${before}%`, background: 'rgba(25,158,112,0.45)' }} />
              {before > 0 && now > 0 && <span style={{ width: 2, background: INK.surface }} />}
              <span style={{ width: `${now}%`, background: TRAIL_COLOR }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
