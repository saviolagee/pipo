// Janela de dashboards (Fase 22): visão geral (hoje/semana/mês/ano), ano, ritmo, clientes, equipe e
// dinheiro; tabela em cada gráfico, CSV/PDF e "pergunte ao dashboard".
import { useEffect, useMemo, useState } from 'react';
import type { DashData, DashRange } from '@shared/dashboard';
import { fmtHM, fmtMoney } from '@shared/format';
import { PIPO_COLORS, type PipoColor } from '@shared/pipos';
import type { ActivityBlock, Client } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { BarChart, DataTable, Funnel, HBars, INK, LegendSwatch, LineChart, RhythmHeatmap, SERIES, toCsv, YearHeatmap } from './charts';

const d = t.dash;
type Tab = keyof typeof d.tabs;
type Period = 'today' | 'week' | 'month' | 'year';

const pad = (n: number): string => String(n).padStart(2, '0');
const key = (x: Date): string => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const ddmm = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function shift(period: Period, ref: Date, dir: number): Date {
  if (period === 'today') return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + dir);
  if (period === 'week') return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 7 * dir);
  if (period === 'month') return new Date(ref.getFullYear(), ref.getMonth() + dir, 1);
  return new Date(ref.getFullYear() + dir, 0, 1);
}

function periodLabel(r: DashRange): string {
  const s = periodLabelRaw(r);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function periodLabelRaw(r: DashRange): string {
  const a = parse(r.from);
  if (r.kind === 'today') return a.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  if (r.kind === 'month') return a.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  if (r.kind === 'year') return String(a.getFullYear());
  return `${ddmm(r.from)} – ${ddmm(r.to)}`;
}

function Card({ title, children, table, right, wide = false }: { title: string; children: React.ReactNode; table?: { head: string[]; rows: Array<Array<string | number>> }; right?: React.ReactNode; wide?: boolean }): React.JSX.Element {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`rounded-[14px] p-[16px] ${wide ? 'col-span-2' : ''}`} style={{ background: '#121214', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="mb-[12px] flex items-center gap-[10px]">
        <h2 className="text-[13px] font-semibold" style={{ color: INK.primary }}>
          {title}
        </h2>
        <span className="flex-1" />
        {right}
        {table && (
          <button type="button" onClick={() => setAsTable((v) => !v)} className="rounded-full px-[8px] py-[2px] text-[11px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>
            {asTable ? d.chart : d.table}
          </button>
        )}
      </div>
      {asTable && table ? <DataTable head={table.head} rows={table.rows} /> : children}
    </section>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }): React.JSX.Element {
  return (
    <div className="rounded-[14px] px-[16px] py-[12px]" style={{ background: '#121214', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[11.5px]" style={{ color: INK.secondary }}>
        {label}
      </div>
      <div className="mono mt-[2px] text-[24px] font-semibold leading-tight" style={{ color: accent ?? INK.primary }}>
        {value}
      </div>
      {sub && (
        <div className="mt-[2px] text-[11px]" style={{ color: INK.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const CAT_COLOR: Record<string, string> = { work: SERIES[0], client: SERIES[0], meeting: SERIES[6], distraction: SERIES[1], other: '#52525B' };

/** Linha do tempo de hoje: blocos por app/cliente, ociosidade fica vazia. */
function DayTimeline({ date, clients }: { date: string; clients: Client[] }): React.JSX.Element {
  const [blocks, setBlocks] = useState<ActivityBlock[]>([]);
  useEffect(() => {
    const a = parse(date);
    void api.invoke('activity:blocks', a.toISOString(), new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).toISOString()).then(setBlocks);
  }, [date]);
  const real = blocks.filter((b) => !b.idle && b.category !== 'idle');
  if (!real.length) return <p className="text-[12px]" style={{ color: INK.muted }}>{d.noData}</p>;
  const start = Math.min(...real.map((b) => Date.parse(b.startedAt)));
  const end = Math.max(...real.map((b) => Date.parse(b.endedAt)));
  const span = Math.max(1, end - start);
  const color = (b: ActivityBlock): string => (b.clientId ? (clients.find((c) => c.id === b.clientId)?.color ?? SERIES[0]) : (CAT_COLOR[b.category] ?? CAT_COLOR.other));
  const hours: number[] = [];
  for (let h = new Date(start).getHours() + 1; h <= new Date(end).getHours(); h++) hours.push(h);
  return (
    <div>
      <div className="relative h-[34px] w-full overflow-hidden rounded-[6px]" style={{ background: '#18181b' }}>
        {real.map((b) => {
          const l = ((Date.parse(b.startedAt) - start) / span) * 100;
          const w = Math.max(0.25, ((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / span) * 100);
          const cl = b.clientId ? clients.find((c) => c.id === b.clientId)?.name : null;
          return <span key={b.id} className="absolute inset-y-0" style={{ left: `${l}%`, width: `calc(${w}% - 1px)`, background: color(b) }} title={`${new Date(b.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${cl ?? b.app} · ${Math.round((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60_000)} min`} />;
        })}
      </div>
      <div className="relative mt-[4px] h-[14px] text-[10.5px]" style={{ color: INK.muted }}>
        {hours.map((h) => {
          const at = new Date(start);
          at.setHours(h, 0, 0, 0);
          return (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((at.getTime() - start) / span) * 100}%` }}>
              {h}h
            </span>
          );
        })}
      </div>
      <div className="mt-[8px] flex flex-wrap gap-[12px] text-[11px]" style={{ color: INK.secondary }}>
        <LegendSwatch color={SERIES[0]} label="trabalho" />
        <LegendSwatch color={SERIES[6]} label="reunião" />
        <LegendSwatch color={SERIES[1]} label="distração" />
        {clients.slice(0, 4).map((c) => (
          <LegendSwatch key={c.id} color={c.color} label={c.name} />
        ))}
      </div>
    </div>
  );
}

function Overview({ data, clients }: { data: DashData; clients: Client[] }): React.JSX.Element {
  const t2 = data.totals;
  const days = data.days;
  const absenceColor = (s: string | null): string | null => (s === 'vacation' ? SERIES[2] : s && ['off', 'holiday', 'sick'].includes(s) ? SERIES[1] : null);
  const bars = days.map((x) => ({
    key: x.date,
    label: data.range.kind === 'week' ? WD[x.weekday] : ddmm(x.date),
    values: [x.workedMin - x.extraMin, x.extraMin],
    ref: x.goalMin,
    marker: absenceColor(x.status) ? { color: absenceColor(x.status) as string, label: d.absenceLabel[x.status ?? ''] ?? '' } : null,
    tip: [
      `${WD[x.weekday]} ${ddmm(x.date)}${x.status ? ` · ${d.absenceLabel[x.status] ?? x.status}${x.statusNote ? ` (${x.statusNote})` : ''}` : ''}`,
      `${fmtHM(x.workedMin)} ${d.worked}${x.goalMin ? ` · ${d.goal} ${fmtHM(x.goalMin)}` : ''}`,
      ...(x.extraMin ? [`${fmtHM(x.extraMin)} ${d.extra}`] : []),
      `foco ${fmtHM(x.focusMin)} · distração ${fmtHM(x.distractedMin)}`,
    ],
  }));
  const focusShare = t2.focusMin + t2.distractedMin > 0 ? t2.focusMin / (t2.focusMin + t2.distractedMin) : 0;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-4 gap-[12px]">
        <Kpi label={d.kpi.hours} value={fmtHM(t2.workedMin)} sub={`${d.kpi.ofGoal(fmtHM(t2.goalMin))} · ${d.kpi.goalDays(t2.goalDays, days.filter((x) => x.goalMin > 0).length)}`} />
        <Kpi label={d.kpi.focus} value={fmtHM(t2.focusMin)} sub={`${d.kpi.distraction}: ${fmtHM(t2.distractedMin)}`} />
        <Kpi label={d.kpi.tasks} value={String(t2.tasksDone)} sub={d.kpi.created(t2.tasksCreated)} />
        {data.money ? (
          <Kpi label={d.kpi.money} value={fmtMoney(data.money.total, data.money.currency, true)} sub="Stripe" accent="#4ADE80" />
        ) : (
          <Kpi label={d.kpi.streak} value={`${data.streak.current} dias`} sub={d.kpi.best(data.streak.best)} />
        )}
      </div>
      {data.range.kind === 'today' ? (
        <Card title={d.timeline} wide>
          <DayTimeline date={data.range.from} clients={clients} />
        </Card>
      ) : (
        <Card
          title={d.hoursByDay}
          table={{ head: ['Dia', 'Horas', 'Meta', 'Extra', 'Foco', 'Distração', 'Status'], rows: days.map((x) => [ddmm(x.date), fmtHM(x.workedMin), fmtHM(x.goalMin), fmtHM(x.extraMin), fmtHM(x.focusMin), fmtHM(x.distractedMin), x.status ? (d.absenceLabel[x.status] ?? x.status) : '']) }}
          right={
            <div className="flex gap-[12px] text-[11px]" style={{ color: INK.secondary }}>
              <LegendSwatch color={SERIES[0]} label={d.worked} />
              <LegendSwatch color={SERIES[1]} label={d.extra} />
              <LegendSwatch color={INK.secondary} label={d.goal} line />
              <LegendSwatch color={SERIES[2]} label="férias" hatch />
            </div>
          }
        >
          <BarChart data={bars} colors={[SERIES[0], SERIES[1]]} fmt={(v) => `${Math.round(v / 60)}h`} unit={60} />
        </Card>
      )}
      <div className="grid grid-cols-2 gap-[14px]">
        <Card title={d.focusVsDistraction}>
          <div className="flex h-[16px] w-full overflow-hidden rounded-[4px]" style={{ background: '#18181b' }}>
            <span style={{ width: `${focusShare * 100}%`, background: SERIES[0] }} />
            {focusShare > 0 && focusShare < 1 && <span style={{ width: 2, background: '#121214' }} />}
            <span style={{ flex: 1, background: t2.distractedMin ? SERIES[1] : 'transparent' }} />
          </div>
          <div className="mt-[8px] flex justify-between text-[12px]" style={{ color: INK.secondary }}>
            <LegendSwatch color={SERIES[0]} label={`foco ${fmtHM(t2.focusMin)} (${Math.round(focusShare * 100)}%)`} />
            <LegendSwatch color={SERIES[1]} label={`distração ${fmtHM(t2.distractedMin)}`} />
          </div>
          <div className="mt-[14px]">
            <div className="mb-[8px] text-[12px] font-medium" style={{ color: INK.secondary }}>
              {d.topDistractions}
            </div>
            {data.distractions.length ? <HBars rows={data.distractions.map((x) => ({ key: x.label, label: x.label, value: x.minutes, color: SERIES[1] }))} fmt={fmtHM} /> : <p className="text-[12px]" style={{ color: INK.muted }}>{d.noDistractions}</p>}
          </div>
        </Card>
        <Card title={data.range.kind === 'today' ? d.tasksByDay : d.moodOverTime} table={{ head: ['Dia', 'Concluídas', 'Criadas', 'Humor'], rows: days.map((x) => [ddmm(x.date), x.tasksDone, x.tasksCreated, x.mood ?? '']) }}>
          {data.range.kind === 'today' || days.length < 2 ? (
            <div className="flex items-center gap-[16px]">
              <Mascot state={t2.moodAvg !== null && t2.moodAvg >= 70 ? 'happy' : 'idle'} size={56} mood={t2.moodAvg ?? 60} />
              <div className="text-[12.5px]" style={{ color: INK.secondary }}>
                {d.kpi.mood}: <span className="mono" style={{ color: INK.primary }}>{t2.moodAvg ?? '—'}</span>
                <br />
                {d.kpi.streak}: <span className="mono" style={{ color: INK.primary }}>{data.streak.current}</span> ({d.kpi.best(data.streak.best)})
              </div>
            </div>
          ) : (
            <LineChart points={days.map((x) => ({ x: x.date, y: x.mood }))} fmtX={(x) => (data.range.kind === 'week' ? WD[parse(x).getDay()] : ddmm(x))} />
          )}
        </Card>
      </div>
      {data.range.kind !== 'today' && days.length > 1 && (
        <Card title={d.tasksByDay} right={<div className="flex gap-[12px] text-[11px]" style={{ color: INK.secondary }}><LegendSwatch color={SERIES[0]} label={d.done} /><LegendSwatch color={SERIES[1]} label={d.created2} /></div>}>
          <BarChart
            data={days.map((x) => ({ key: x.date, label: data.range.kind === 'week' ? WD[x.weekday] : ddmm(x.date), values: [x.tasksDone], tip: [ddmm(x.date), `${x.tasksDone} ${d.done}`, `${x.tasksCreated} ${d.created2}`], ref: x.tasksCreated }))}
            colors={[SERIES[0]]}
            height={150}
            fmt={(v) => String(Math.round(v))}
          />
        </Card>
      )}
    </div>
  );
}

function YearView({ data }: { data: DashData }): React.JSX.Element {
  const year = parse(data.range.from).getFullYear();
  const cells = new Map(
    data.days.map((x) => [
      x.date,
      {
        value: x.workedMin,
        absence: x.status === 'vacation' ? { color: SERIES[2], label: 'férias' } : x.status && ['off', 'holiday', 'sick'].includes(x.status) && x.workedMin < 30 ? { color: SERIES[1], label: d.absenceLabel[x.status] } : null,
        tip: [`${WD[x.weekday]} ${x.date.split('-').reverse().join('/')}`, x.status ? `${d.absenceLabel[x.status] ?? x.status}${x.statusNote ? ` · ${x.statusNote}` : ''}` : '', `${fmtHM(x.workedMin)} ${d.worked}`].filter(Boolean),
      },
    ]),
  );
  const t2 = data.totals;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-5 gap-[12px]">
        <Kpi label={d.daysWorked} value={String(t2.daysWorked)} sub={`${fmtHM(t2.workedMin)} no ano`} />
        <Kpi label={d.daysOff} value={String(t2.daysOff)} />
        <Kpi label={d.vacation} value={String(t2.vacationDays)} />
        <Kpi label={d.holidays} value={String(t2.holidays)} />
        <Kpi label={d.extraHours} value={fmtHM(t2.extraMin)} sub={d.kpi.extraHint} />
      </div>
      <Card title={d.yearTitle(year)} table={{ head: ['Dia', 'Horas', 'Status'], rows: data.days.filter((x) => x.workedMin > 0 || x.status).map((x) => [x.date.split('-').reverse().join('/'), fmtHM(x.workedMin), x.status ? (d.absenceLabel[x.status] ?? x.status) : '']) }}>
        <YearHeatmap year={year} cells={cells} fmt={fmtHM} />
        <p className="mt-[10px] text-[12px]" style={{ color: INK.secondary }}>
          {d.kpi.streak}: <span className="mono" style={{ color: INK.primary }}>{data.streak.current}</span> · {d.kpi.best(data.streak.best)}
        </p>
      </Card>
    </div>
  );
}

function RhythmView({ data }: { data: DashData }): React.JSX.Element {
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const byHour = new Array<number>(24).fill(0);
  data.rhythm.forEach((row) => row.forEach((m, h) => (byHour[h] += m)));
  const best = byHour
    .map((m, h) => ({ h, m }))
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, 2)
    .sort((a, b) => a.h - b.h);
  const total = byHour.reduce((a, b) => a + b, 0);
  return (
    <Card
      title={d.rhythmTitle}
      wide
      table={{ head: ['Dia', ...Array.from({ length: 24 }, (_, h) => `${h}h`)], rows: [1, 2, 3, 4, 5, 6, 0].map((wd) => [names[wd], ...data.rhythm[wd].map((m) => Math.round(m))]) }}
    >
      {total === 0 ? (
        <p className="text-[12px]" style={{ color: INK.muted }}>{d.noData}</p>
      ) : (
        <>
          <p className="mb-[10px] text-[13px]" style={{ color: INK.primary }}>
            {d.bestHours(best.map((x) => `${x.h}h–${x.h + 1}h`).join(' e '))}
          </p>
          <RhythmHeatmap grid={data.rhythm} fmt={(v) => `${Math.round(v)} min`} />
        </>
      )}
    </Card>
  );
}

function ClientsView({ data, onSaved }: { data: DashData; onSaved: () => void }): React.JSX.Element {
  const [edit, setEdit] = useState<Record<number, { rate: string; contract: string }>>({});
  const rows = data.clients;
  return (
    <div className="flex flex-col gap-[14px]">
      <Card title={d.clientsTitle} table={{ head: ['Cliente', 'Horas', d.rate, d.contract, d.value, d.effective], rows: rows.map((c) => [c.name, fmtHM(c.minutes), c.hourlyRate ?? '', c.monthlyValue ?? '', c.value ?? '', c.effectiveRate ?? '']) }}>
        {rows.length ? <HBars rows={rows.map((c) => ({ key: c.name, label: c.name, value: c.minutes, color: c.color, extra: c.effectiveRate ? `R$ ${c.effectiveRate}/h` : undefined }))} fmt={fmtHM} /> : <p className="text-[12px]" style={{ color: INK.muted }}>{d.noData}</p>}
      </Card>
      {rows.some((c) => c.id) && (
        <Card title={`${d.rate} e ${d.contract.toLowerCase()}`}>
          <div className="flex flex-col gap-[6px]">
            {rows
              .filter((c) => c.id)
              .map((c) => {
                const e = edit[c.id as number] ?? { rate: c.hourlyRate?.toString() ?? '', contract: c.monthlyValue?.toString() ?? '' };
                const set = (patch: Partial<typeof e>): void => setEdit((x) => ({ ...x, [c.id as number]: { ...e, ...patch } }));
                return (
                  <div key={c.id} className="grid grid-cols-[160px_130px_130px_1fr] items-center gap-[10px] text-[12px]">
                    <span className="flex items-center gap-[6px]" style={{ color: INK.primary }}>
                      <span className="h-[8px] w-[8px] rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <input aria-label={`${d.rate} ${c.name}`} value={e.rate} onChange={(ev) => set({ rate: ev.target.value })} placeholder="R$/h" className="mono h-[28px] rounded-[8px] px-[8px] outline-none" style={{ background: '#1c1c20', color: INK.primary }} />
                    <input aria-label={`${d.contract} ${c.name}`} value={e.contract} onChange={(ev) => set({ contract: ev.target.value })} placeholder="R$/mês" className="mono h-[28px] rounded-[8px] px-[8px] outline-none" style={{ background: '#1c1c20', color: INK.primary }} />
                    <span>
                      <button
                        type="button"
                        className="rounded-full px-[10px] py-[3px] text-[11.5px]"
                        style={{ background: 'rgba(255,255,255,0.08)', color: INK.primary }}
                        onClick={async () => {
                          const num = (s: string): number | null => (s.trim() ? Number(s.replace(/\./g, '').replace(',', '.')) || null : null);
                          await api.invoke('dash:setClientEcon', c.id as number, { hourlyRate: num(e.rate), monthlyValue: num(e.contract) });
                          onSaved();
                        }}
                      >
                        {t.common.save}
                      </button>
                    </span>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}

function TeamView({ data }: { data: DashData }): React.JSX.Element {
  if (!data.team.length) return <p className="text-[13px]" style={{ color: INK.muted }}>{d.noTeam}</p>;
  return (
    <div className="grid grid-cols-2 gap-[14px]">
      {data.team.map((p) => {
        const color = PIPO_COLORS[p.color as PipoColor] ?? SERIES[0];
        const stages = p.metrics.filter((m) => m.stage !== null).sort((a, b) => (a.stage as number) - (b.stage as number));
        return (
          <Card
            key={p.pipoId}
            title={p.name}
            right={<Mascot state="idle" size={26} color={color} glow={false} still />}
            table={{ head: ['Versão', 'Execuções', ...p.metrics.map((m) => m.label)], rows: p.versions.map((v) => [`v${v.version}`, v.runs, ...p.metrics.map((m) => v.metrics[m.key] ?? 0)]) }}
          >
            <div className="mb-[12px] grid grid-cols-4 gap-[8px] text-[11.5px]" style={{ color: INK.secondary }}>
              <div>
                <div className="mono text-[18px]" style={{ color: INK.primary }}>{p.runs}</div>
                {d.runs}
              </div>
              <div>
                <div className="mono text-[18px]" style={{ color: INK.primary }}>{p.runs ? `${Math.round((p.ok / p.runs) * 100)}%` : '—'}</div>
                {d.success}
              </div>
              <div>
                <div className="mono text-[18px]" style={{ color: INK.primary }}>{p.avgSec === null ? '—' : p.avgSec < 60 ? `${p.avgSec}s` : `${Math.round(p.avgSec / 60)}min`}</div>
                {d.avg}
              </div>
              <div>
                <div className="mono text-[18px]" style={{ color: INK.primary }}>{p.savedMin ? fmtHM(p.savedMin) : '—'}</div>
                {d.savedTime}
              </div>
            </div>
            {stages.length >= 2 ? (
              <Funnel stages={stages.map((m) => ({ label: m.label, value: m.total }))} color={color} />
            ) : p.metrics.length ? (
              <HBars rows={p.metrics.map((m) => ({ key: m.key, label: m.label, value: m.total, color }))} fmt={(v) => String(v)} />
            ) : null}
            {p.versions.length > 1 && (
              <div className="mt-[12px]">
                <div className="mb-[6px] text-[12px] font-medium" style={{ color: INK.secondary }}>{d.versions}</div>
                <DataTable head={['Versão', 'Execuções', ...p.metrics.map((m) => `${m.label}/exec.`)]} rows={p.versions.map((v) => [`v${v.version}`, v.runs, ...p.metrics.map((m) => (v.runs ? Math.round(((v.metrics[m.key] ?? 0) / v.runs) * 10) / 10 : 0))])} />
              </div>
            )}
            {p.lastFailure && (
              <p className="mt-[10px] truncate text-[11.5px]" style={{ color: '#FCA5A5' }}>
                {d.lastFailure}: {new Date(p.lastFailure.at).toLocaleString('pt-BR')} — {p.lastFailure.error}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function MoneyView({ data }: { data: DashData }): React.JSX.Element {
  if (!data.money) return <p className="text-[13px]" style={{ color: INK.muted }}>{d.noMoney}</p>;
  const m = data.money;
  const by = new Map(m.days.map((x) => [x.date, x.amount]));
  const days = data.days.map((x) => ({ date: x.date, amount: by.get(x.date) ?? 0 }));
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-3 gap-[12px]">
        <Kpi label={d.kpi.money} value={fmtMoney(m.total, m.currency)} accent="#4ADE80" />
        <Kpi label="Média por dia" value={fmtMoney(days.length ? m.total / days.length : 0, m.currency)} />
        <Kpi label="Melhor dia" value={fmtMoney(Math.max(0, ...days.map((x) => x.amount)), m.currency)} />
      </div>
      <Card title={d.moneyTitle} table={{ head: ['Dia', 'Valor'], rows: days.map((x) => [ddmm(x.date), fmtMoney(x.amount, m.currency)]) }}>
        <BarChart data={days.map((x) => ({ key: x.date, label: ddmm(x.date), values: [x.amount], tip: [ddmm(x.date), fmtMoney(x.amount, m.currency)] }))} colors={[SERIES[2]]} fmt={(v) => fmtMoney(v, m.currency, true)} />
      </Card>
    </div>
  );
}

function csvFor(tab: Tab, data: DashData): string {
  if (tab === 'rhythm') return toCsv(['dia', ...Array.from({ length: 24 }, (_, h) => `${h}h`)], data.rhythm.map((row, wd) => [WD[wd], ...row]));
  if (tab === 'clients') return toCsv(['cliente', 'minutos', 'valor_hora', 'contrato_mes', 'valor_periodo', 'r$_hora_efetivo'], data.clients.map((c) => [c.name, c.minutes, c.hourlyRate, c.monthlyValue, c.value, c.effectiveRate]));
  if (tab === 'team') return toCsv(['pipo', 'execucoes', 'ok', 'falhas', 'duracao_media_s', 'economizado_min', 'metricas'], data.team.map((p) => [p.name, p.runs, p.ok, p.failed, p.avgSec, p.savedMin, p.metrics.map((m) => `${m.label}=${m.total}`).join(' | ')]));
  if (tab === 'money' && data.money) return toCsv(['dia', 'valor'], data.money.days.map((x) => [x.date, x.amount]));
  return toCsv(['dia', 'minutos', 'meta', 'extra', 'foco', 'distracao', 'reunioes', 'tarefas_feitas', 'tarefas_criadas', 'humor', 'status'], data.days.map((x) => [x.date, x.workedMin, x.goalMin, x.extraMin, x.focusMin, x.distractedMin, x.meetingMin, x.tasksDone, x.tasksCreated, x.mood, x.status]));
}

export function DashboardApp(): React.JSX.Element {
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'overview');
  const [period, setPeriod] = useState<Period>('week');
  const [ref, setRef] = useState(new Date());
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);

  const effective: Period = tab === 'year' ? 'year' : period;
  const range = useMemo<DashRange>(() => ({ kind: effective, from: key(ref), to: key(ref) }), [effective, ref]);
  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await api.invoke('dash:data', range));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [range]);
  useEffect(() => {
    void api.invoke('clients:list').then(setClients);
    const off = api.on('dash:tab', (x) => setTab(x as Tab));
    const id = setInterval(() => void load(), 60_000);
    return () => {
      off();
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(id);
  }, [msg]);

  const ask = async (): Promise<void> => {
    if (!q.trim() || !data) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await api.invoke('dash:ask', q.trim(), data.range));
    } catch (e) {
      setAnswer(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setAsking(false);
    }
  };

  const tabs = (Object.keys(d.tabs) as Tab[]).filter((x) => x !== 'money' || !!data?.money || tab === 'money');
  return (
    <div className="dash-root min-h-screen w-full" style={{ background: '#0B0B0D', color: INK.primary }}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-[12px] px-[24px] py-[14px]" style={{ background: 'rgba(11,11,13,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Mascot state="happy" size={28} glow={false} still />
        <h1 className="text-[15px] font-semibold">{d.title}</h1>
        <nav className="ml-[8px] flex gap-[2px] rounded-full p-[3px]" style={{ background: '#121214' }}>
          {tabs.map((x) => (
            <button key={x} type="button" onClick={() => setTab(x)} className="rounded-full px-[12px] py-[4px] text-[12.5px]" style={{ background: tab === x ? '#2A2A2E' : 'transparent', color: tab === x ? INK.primary : INK.secondary }}>
              {d.tabs[x]}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        {tab !== 'year' && (
          <div className="flex gap-[2px] rounded-full p-[3px]" style={{ background: '#121214' }}>
            {(['today', 'week', 'month', 'year'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)} className="rounded-full px-[10px] py-[3px] text-[12px]" style={{ background: period === p ? '#2A2A2E' : 'transparent', color: period === p ? INK.primary : INK.secondary }}>
                {d.periods[p]}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-[4px] text-[12.5px]">
          <button type="button" aria-label={d.prev} onClick={() => setRef((r) => shift(effective, r, -1))} className="rounded-full px-[8px] py-[2px] hover:bg-white/[0.06]">‹</button>
          <span className="min-w-[150px] text-center" style={{ color: INK.primary }}>{data ? periodLabel(data.range) : ''}</span>
          <button type="button" aria-label={d.next} onClick={() => setRef((r) => shift(effective, r, 1))} className="rounded-full px-[8px] py-[2px] hover:bg-white/[0.06]">›</button>
        </div>
        <button type="button" onClick={() => data && void api.invoke('dash:exportCsv', `pipo-${tab}-${data.range.from}`, csvFor(tab, data)).then((p) => p && setMsg(d.saved(p)))} className="rounded-full px-[10px] py-[3px] text-[12px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>{d.csv}</button>
        <button type="button" onClick={() => data && void api.invoke('dash:exportPdf', `pipo-${tab}-${data.range.from}`).then((p) => p && setMsg(d.saved(p)))} className="rounded-full px-[10px] py-[3px] text-[12px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>{d.pdf}</button>
      </header>

      <div className="px-[24px] pt-[14px]">
        <div className="flex items-center gap-[8px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ask()}
            placeholder={d.askPlaceholder}
            aria-label={d.askPlaceholder}
            className="h-[36px] flex-1 rounded-full px-[16px] text-[13px] outline-none"
            style={{ background: '#121214', border: '1px solid rgba(255,255,255,0.06)', color: INK.primary }}
          />
          {msg && <span className="text-[12px]" style={{ color: INK.secondary }}>{msg}</span>}
          {loading && <span className="text-[12px]" style={{ color: INK.muted }}>…</span>}
        </div>
        {(asking || answer) && (
          <div className="mt-[8px] flex items-start gap-[10px] rounded-[12px] px-[14px] py-[10px] text-[13px]" style={{ background: '#121214', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Mascot state={asking ? 'thinking' : 'happy'} size={22} glow={false} />
            <span style={{ color: asking ? INK.muted : INK.primary }}>
              {asking
                ? d.asking
                : (answer ?? '').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
                    part.startsWith('**') && part.endsWith('**') ? (
                      <strong key={i} className="font-semibold">
                        {part.slice(2, -2)}
                      </strong>
                    ) : (
                      part
                    ),
                  )}
            </span>
          </div>
        )}
      </div>

      <main className="px-[24px] py-[16px]">
        {!data ? null : tab === 'overview' ? (
          <Overview data={data} clients={clients} />
        ) : tab === 'year' ? (
          <YearView data={data} />
        ) : tab === 'rhythm' ? (
          <div className="grid grid-cols-2 gap-[14px]"><RhythmView data={data} /></div>
        ) : tab === 'clients' ? (
          <ClientsView data={data} onSaved={() => void load()} />
        ) : tab === 'team' ? (
          <TeamView data={data} />
        ) : (
          <MoneyView data={data} />
        )}
      </main>
    </div>
  );
}
