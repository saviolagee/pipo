// Abas dos dashboards contadas pelo que foi feito: visão geral, ano, ritmo e clientes.
import type { DashData } from '@shared/dashboard';
import { fmtMoney } from '@shared/format';
import { t } from '../i18n/pt-BR';
import { Mascot } from '../mascot/Mascot';
import { ActivityList, CalendarGrid, ddmm, dayTip, GoalsProgress, TRAIL_COLOR } from './activity';
import { BarChart, HBars, INK, LegendSwatch, LineChart, RhythmHeatmap, SERIES, YearHeatmap } from './charts';
import { Card, Kpi } from './ui';

const d = t.dash;
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const count = (v: number): string => String(Math.round(v));

/** Mapa do ano: cada dia com quantas atividades foram feitas. */
function yearCells(data: DashData): Map<string, { value: number; absence: { color: string; label: string } | null; tip: string[] }> {
  return new Map(
    data.days.map((x) => [
      x.date,
      {
        value: x.done,
        absence: x.done > 0 ? null : x.status === 'vacation' ? { color: SERIES[2], label: d.absenceLabel.vacation } : x.status && ['off', 'holiday', 'sick'].includes(x.status) ? { color: SERIES[1], label: d.absenceLabel[x.status] } : null,
        tip: dayTip(x),
      },
    ]),
  );
}

/** Barras de atividades feitas: por dia, ou por mês no ano. */
function DoneBars({ data }: { data: DashData }): React.JSX.Element {
  const year = data.range.kind === 'year';
  const bars = year
    ? MONTHS.map((m, i) => {
        const of = data.days.filter((x) => parse(x.date).getMonth() === i);
        const tasks = of.reduce((a, x) => a + x.tasksDone, 0);
        const actions = of.reduce((a, x) => a + x.actionsDone, 0);
        return { key: m, label: m, values: [tasks, actions], tip: [m, d.doneLine(tasks + actions, tasks, actions), d.activeDaysLine(of.filter((x) => x.done > 0).length)] };
      })
    : data.days.map((x) => ({
        key: x.date,
        label: data.range.kind === 'week' ? WD[x.weekday] : ddmm(x.date),
        values: [x.tasksDone, x.actionsDone],
        marker: x.done === 0 && x.status && ['off', 'holiday', 'sick', 'vacation'].includes(x.status) ? { color: x.status === 'vacation' ? SERIES[2] : SERIES[1], label: d.absenceLabel[x.status] ?? '' } : null,
        tip: dayTip(x),
      }));
  return <BarChart data={bars} colors={[SERIES[0], TRAIL_COLOR]} height={170} fmt={count} integer />;
}

const legend = (
  <div className="flex gap-[12px] text-[11px]" style={{ color: INK.secondary }}>
    <LegendSwatch color={SERIES[0]} label={d.tasksWord} />
    <LegendSwatch color={TRAIL_COLOR} label={d.trailWord} />
  </div>
);

export function Overview({ data }: { data: DashData }): React.JSX.Element {
  const t2 = data.totals;
  const days = data.days;
  const isToday = data.range.kind === 'today';
  const dayTable = { head: ['Dia', 'Feitas', 'Tarefas', 'Trilha', 'Cadastradas', 'Status'], rows: days.map((x) => [ddmm(x.date), x.done, x.tasksDone, x.actionsDone, x.created, x.status ? (d.absenceLabel[x.status] ?? x.status) : '']) };
  const doneTable = { head: ['Dia', 'Hora', 'Atividade', 'Onde', 'Tipo'], rows: data.activities.map((a) => [ddmm(a.date), new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), a.title, a.where ?? '', a.kind === 'task' ? d.tasksWord : d.trailWord]) };
  const fourth = data.money ? (
    <Kpi label={d.kpi.money} value={fmtMoney(data.money.total, data.money.currency, true)} sub="Stripe" accent="#4ADE80" />
  ) : isToday ? (
    <Kpi label={d.kpi.mood} value={t2.moodAvg === null ? '—' : String(t2.moodAvg)} />
  ) : (
    <Kpi label={d.kpi.perDay} value={String(t2.perActiveDay)} sub={t2.bestDay ? d.kpi.bestDay(ddmm(t2.bestDay.date), t2.bestDay.done) : undefined} />
  );
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-4 gap-[12px]">
        {isToday ? (
          <Kpi label={d.kpi.doneToday} value={String(t2.done)} sub={d.kpi.split(t2.tasksDone, t2.actionsDone)} accent={t2.done ? INK.primary : INK.muted} />
        ) : (
          <Kpi label={d.kpi.activeDays} value={`${t2.activeWorkdays}/${t2.workdays}`} sub={d.kpi.activeDaysSub(t2.activeDays - t2.activeWorkdays)} />
        )}
        {isToday ? <Kpi label={d.kpi.created} value={String(t2.created)} /> : <Kpi label={d.kpi.done} value={String(t2.done)} sub={d.kpi.split(t2.tasksDone, t2.actionsDone)} />}
        <Kpi label={d.kpi.streak} value={d.kpi.days(data.streak.current)} sub={isToday ? d.kpi.best(data.streak.best) : d.kpi.bestAndRun(data.streak.best, t2.longestRun)} />
        {fourth}
      </div>
      {!isToday && (
        <Card title={d.activeDaysTitle} table={dayTable}>
          {data.range.kind === 'year' ? <YearHeatmap year={parse(data.range.from).getFullYear()} cells={yearCells(data)} fmt={d.doneWord} /> : <CalendarGrid range={data.range} days={days} />}
        </Card>
      )}
      {!isToday && (
        <Card title={data.range.kind === 'year' ? d.doneByMonth : d.doneByDay} right={legend} table={dayTable}>
          <DoneBars data={data} />
        </Card>
      )}
      <div className="grid grid-cols-2 gap-[14px]">
        <Card title={isToday ? d.whatTodayTitle : d.whatTitle} table={doneTable}>
          <ActivityList items={data.activities} more={data.activitiesMore} empty={isToday ? d.nothingToday : d.noData} />
        </Card>
        <div className="flex flex-col gap-[14px]">
          <Card title={d.goalsTitle} table={{ head: ['Plano', 'No período', 'Feitas', 'Total'], rows: data.goals.map((g) => [g.title, g.doneInRange, g.done, g.total]) }}>
            <GoalsProgress goals={data.goals} />
          </Card>
          <Card title={d.moodOverTime} grow>
            {isToday || days.length < 2 ? (
              <div className="flex items-center gap-[16px]">
                <Mascot state={t2.moodAvg !== null && t2.moodAvg >= 70 ? 'happy' : 'idle'} size={56} mood={t2.moodAvg ?? 60} />
                <div className="text-[12.5px]" style={{ color: INK.secondary }}>
                  {d.kpi.mood}: <span className="mono" style={{ color: INK.primary }}>{t2.moodAvg ?? '—'}</span>
                </div>
              </div>
            ) : (
              <LineChart points={days.map((x) => ({ x: x.date, y: x.mood }))} fmtX={(x) => (data.range.kind === 'week' ? WD[parse(x).getDay()] : ddmm(x))} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function YearView({ data }: { data: DashData }): React.JSX.Element {
  const year = parse(data.range.from).getFullYear();
  const t2 = data.totals;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-5 gap-[12px]">
        <Kpi label={d.kpi.activeDays} value={String(t2.activeDays)} sub={d.kpi.ofWorkdays(t2.activeWorkdays, t2.workdays)} />
        <Kpi label={d.kpi.done} value={String(t2.done)} sub={d.kpi.split(t2.tasksDone, t2.actionsDone)} />
        <Kpi label={d.kpi.longestRun} value={d.kpi.days(t2.longestRun)} sub={d.kpi.best(data.streak.best)} />
        <Kpi label={d.daysOff} value={String(t2.daysOff)} sub={d.kpi.holidays(t2.holidays)} />
        <Kpi label={d.vacation} value={String(t2.vacationDays)} />
      </div>
      <Card title={d.yearTitle(year)} table={{ head: ['Dia', 'Feitas', 'Tarefas', 'Trilha', 'Status'], rows: data.days.filter((x) => x.done > 0 || x.status).map((x) => [x.date.split('-').reverse().join('/'), x.done, x.tasksDone, x.actionsDone, x.status ? (d.absenceLabel[x.status] ?? x.status) : '']) }}>
        <YearHeatmap year={year} cells={yearCells(data)} fmt={d.doneWord} />
        <p className="mt-[10px] text-[12px]" style={{ color: INK.secondary }}>
          {d.kpi.streak}: <span className="mono" style={{ color: INK.primary }}>{data.streak.current}</span> · {d.kpi.best(data.streak.best)}
        </p>
      </Card>
      <Card title={d.doneByMonth} right={legend}>
        <DoneBars data={data} />
      </Card>
    </div>
  );
}

export function RhythmView({ data }: { data: DashData }): React.JSX.Element {
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const byHour = new Array<number>(24).fill(0);
  const byDay = new Array<number>(7).fill(0);
  data.rhythm.forEach((row, wd) => row.forEach((n, h) => ((byHour[h] += n), (byDay[wd] += n))));
  const best = byHour
    .map((n, h) => ({ h, n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .sort((a, b) => a.h - b.h);
  const total = byHour.reduce((a, b) => a + b, 0);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const topDay = order.reduce((a, wd) => (byDay[wd] > byDay[a] ? wd : a), 1);
  return (
    <div className="flex flex-col gap-[14px]">
      <Card title={d.rhythmTitle} table={{ head: ['Dia', ...Array.from({ length: 24 }, (_, h) => `${h}h`)], rows: order.map((wd) => [names[wd], ...data.rhythm[wd]]) }}>
        {total === 0 ? (
          <p className="text-[12px]" style={{ color: INK.muted }}>{d.noData}</p>
        ) : (
          <>
            <p className="mb-[10px] text-[13px]" style={{ color: INK.primary }}>
              {d.bestHours(best.map((x) => `${x.h}h–${x.h + 1}h`).join(' e '))}
            </p>
            <RhythmHeatmap grid={data.rhythm} fmt={d.doneWord} />
          </>
        )}
      </Card>
      {total > 0 && (
        <Card title={d.byWeekdayTitle} right={<span className="text-[11.5px]" style={{ color: INK.secondary }}>{d.bestWeekday(names[topDay])}</span>}>
          <HBars rows={order.map((wd) => ({ key: String(wd), label: names[wd], value: byDay[wd], color: SERIES[0] }))} fmt={d.doneWord} />
        </Card>
      )}
    </div>
  );
}

export function ClientsView({ data }: { data: DashData }): React.JSX.Element {
  const rows = data.clients;
  return (
    <Card title={d.clientsTitle} table={{ head: ['Cliente', 'Feitas no período', 'Abertas agora'], rows: rows.map((c) => [c.name, c.done, c.open]) }}>
      {rows.length ? (
        <HBars rows={rows.map((c) => ({ key: `${c.id ?? 'sem'}`, label: c.name, value: c.done, color: c.color, extra: d.openWord(c.open), tip: [c.name, d.doneWord(c.done), d.openWord(c.open)] }))} fmt={d.doneWord} />
      ) : (
        <p className="text-[12px]" style={{ color: INK.muted }}>{d.noData}</p>
      )}
    </Card>
  );
}
