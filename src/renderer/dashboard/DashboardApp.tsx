// Janela de dashboards (Fase 22): visão geral (hoje/semana/mês/ano), ano, ritmo, clientes, equipe e
// dinheiro, contados pelo que foi feito; tabela em cada gráfico, CSV/PDF e "pergunte ao dashboard".
import { useEffect, useMemo, useState } from 'react';
import type { DashData, DashRange, PipoDash } from '@shared/dashboard';
import { fmtHM, fmtMoney } from '@shared/format';
import { PIPO_COLORS, type PipoColor } from '@shared/pipos';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { BarChart, DataTable, Funnel, HBars, INK, SERIES, toCsv } from './charts';
import { timelineTable } from './PipoCards';
import { PipoDashboard } from './PipoDashboard';
import { Card, Kpi } from './ui';
import { ClientsView, Overview, RhythmView, YearView } from './views';

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

function TeamView({ data, onOpen }: { data: DashData; onOpen: (pipoId: number) => void }): React.JSX.Element {
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
            right={
              <>
                <button type="button" onClick={() => onOpen(p.pipoId)} className="rounded-full px-[10px] py-[2px] text-[11.5px]" style={{ background: 'rgba(255,255,255,0.08)', color: INK.primary }}>
                  {d.pipo.open}
                </button>
                <Mascot state="idle" size={26} color={color} glow={false} still />
              </>
            }
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
  if (tab === 'clients') return toCsv(['cliente', 'feitas_no_periodo', 'abertas_agora'], data.clients.map((c) => [c.name, c.done, c.open]));
  if (tab === 'team') return toCsv(['pipo', 'execucoes', 'ok', 'falhas', 'duracao_media_s', 'economizado_min', 'metricas'], data.team.map((p) => [p.name, p.runs, p.ok, p.failed, p.avgSec, p.savedMin, p.metrics.map((m) => `${m.label}=${m.total}`).join(' | ')]));
  if (tab === 'money' && data.money) return toCsv(['dia', 'valor'], data.money.days.map((x) => [x.date, x.amount]));
  return toCsv(['dia', 'feitas', 'tarefas', 'trilha', 'cadastradas', 'humor', 'status'], data.days.map((x) => [x.date, x.done, x.tasksDone, x.actionsDone, x.created, x.mood, x.status]));
}

/** A aba pedida de fora pode ser o painel de um Pipo: "pipo:<id>". */
function parseTab(raw: string | null): { tab: Tab; pipoId: number | null } {
  const m = /^pipo:(\d+)$/.exec(raw ?? '');
  if (m) return { tab: 'team', pipoId: Number(m[1]) };
  return { tab: raw && raw in d.tabs ? (raw as Tab) : 'overview', pipoId: null };
}

export function DashboardApp(): React.JSX.Element {
  const initial = parseTab(new URLSearchParams(location.search).get('tab'));
  const [tab, setTabRaw] = useState<Tab>(initial.tab);
  // Painel de um Pipo, aberto por cima da aba Equipe.
  const [pipoId, setPipoId] = useState<number | null>(initial.pipoId);
  const [pipoData, setPipoData] = useState<PipoDash | null>(null);
  const setTab = (x: Tab): void => {
    setTabRaw(x);
    setPipoId(null);
  };
  const [period, setPeriod] = useState<Period>('week');
  const [ref, setRef] = useState(new Date());
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

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
    const off = api.on('dash:tab', (x) => {
      const next = parseTab(x);
      setTabRaw(next.tab);
      setPipoId(next.pipoId);
    });
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
  const onPipo = tab === 'team' && pipoId !== null;
  const exportName = onPipo && pipoData ? pipoData.pipo.slug : tab;
  return (
    <div className="dash-root min-h-screen w-full" style={{ background: '#0B0B0D', color: INK.primary }}>
      <header className="sticky top-0 z-10 flex items-center gap-[10px] whitespace-nowrap px-[24px] py-[14px]" style={{ background: 'rgba(11,11,13,0.86)', backdropFilter: 'blur(14px) saturate(140%)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Mascot state="happy" size={28} glow={false} still />
        <h1 className="text-[15px] font-semibold">{d.title}</h1>
        <nav className="ml-[6px] flex min-w-0 gap-[2px] overflow-x-auto rounded-full p-[3px]" style={{ background: '#121214', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)', scrollbarWidth: 'none' }}>
          {tabs.map((x) => (
            <button key={x} type="button" onClick={() => setTab(x)} className="shrink-0 rounded-full px-[11px] py-[4px] text-[12.5px] transition-colors" style={{ background: tab === x ? '#2A2A2E' : 'transparent', color: tab === x ? INK.primary : INK.secondary }}>
              {d.tabs[x]}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        {tab !== 'year' && (
          <div className="flex shrink-0 gap-[2px] rounded-full p-[3px]" style={{ background: '#121214', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
            {(['today', 'week', 'month', 'year'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)} className="rounded-full px-[10px] py-[3px] text-[12px] transition-colors" style={{ background: period === p ? '#2A2A2E' : 'transparent', color: period === p ? INK.primary : INK.secondary }}>
                {d.periods[p]}
              </button>
            ))}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-[2px] text-[12.5px]">
          <button type="button" aria-label={d.prev} onClick={() => setRef((r) => shift(effective, r, -1))} className="rounded-full px-[8px] py-[2px] hover:bg-white/[0.06]">‹</button>
          <span className="min-w-[108px] text-center" style={{ color: INK.primary }}>{data ? periodLabel(data.range) : ''}</span>
          <button type="button" aria-label={d.next} onClick={() => setRef((r) => shift(effective, r, 1))} className="rounded-full px-[8px] py-[2px] hover:bg-white/[0.06]">›</button>
        </div>
        <div className="flex shrink-0 items-center">
        <button type="button" onClick={() => data && void api.invoke('dash:exportCsv', `pipo-${exportName}-${data.range.from}`, onPipo && pipoData ? toCsv(timelineTable(pipoData).head, timelineTable(pipoData).rows) : csvFor(tab, data)).then((p) => p && setMsg(d.saved(p)))} className="rounded-full px-[10px] py-[3px] text-[12px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>{d.csv}</button>
        <button type="button" onClick={() => data && void api.invoke('dash:exportPdf', `pipo-${exportName}-${data.range.from}`).then((p) => p && setMsg(d.saved(p)))} className="rounded-full px-[10px] py-[3px] text-[12px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>{d.pdf}</button>
        </div>
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
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: INK.primary }}
          />
          {msg && <span className="text-[12px]" style={{ color: INK.secondary }}>{msg}</span>}
          {loading && <span className="text-[12px]" style={{ color: INK.muted }}>…</span>}
        </div>
        {(asking || answer) && (
          <div className="mt-[8px] flex items-start gap-[10px] rounded-[12px] px-[14px] py-[10px] text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
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
          <Overview data={data} />
        ) : tab === 'year' ? (
          <YearView data={data} />
        ) : tab === 'rhythm' ? (
          <RhythmView data={data} />
        ) : tab === 'clients' ? (
          <ClientsView data={data} />
        ) : tab === 'team' ? (
          pipoId !== null ? (
            <PipoDashboard pipoId={pipoId} range={data.range} onBack={() => setPipoId(null)} onData={setPipoData} />
          ) : (
            <TeamView data={data} onOpen={setPipoId} />
          )
        ) : (
          <MoneyView data={data} />
        )}
      </main>
    </div>
  );
}
