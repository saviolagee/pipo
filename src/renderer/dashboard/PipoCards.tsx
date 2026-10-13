// Cartões do painel de cada Pipo: resultados (as métricas dele), agora e custo, gráfico por dia,
// comparação com o período anterior, funil, falhas e motivos, o que ele produziu e as execuções.
import { useState } from 'react';
import type { PipoDash, PipoDashOutput } from '@shared/dashboard';
import { fmtCount, fmtDue, fmtDur, fmtHM } from '@shared/format';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { BarChart, Funnel, INK, SERIES } from './charts';
import { BAD, Delta, GOOD, Kpi } from './ui';

const p = t.dash.pipo;
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ddmm = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (ok: number, runs: number): number | null => (runs ? Math.round((ok / runs) * 100) : null);
const days = (a: string, b: string): number => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000) + 1;

/** "semana anterior", ou "mesmo trecho da semana anterior" quando o período atual ainda não acabou. */
export function prevLabel(data: PipoDash): string {
  const partial = days(data.prevRange.from, data.prevRange.to) < days(data.range.from, data.range.to);
  return (partial ? p.prevPartial[data.range.kind] : undefined) ?? p.prev[data.range.kind] ?? p.prev.custom;
}

export const headlineOf = (data: PipoDash): PipoDash['metrics'][number] | null => data.metrics.find((m) => m.headline) ?? null;

export function overTimeTitle(data: PipoDash): string {
  const head = headlineOf(data);
  return head ? p.perDay(cap(head.label)) : p.runsPerDay;
}

const Empty = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <p className="text-[12px]" style={{ color: INK.muted }}>
    {children}
  </p>
);

/** As métricas do Pipo: a principal como número grande, as outras ao lado, todas contra o período anterior. */
export function Results({ data, color }: { data: PipoDash; color: string }): React.JSX.Element {
  const head = headlineOf(data);
  const rest = data.metrics.filter((m) => !m.headline);
  const tt = data.totals;
  const vs = prevLabel(data);
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-[36px] gap-y-[16px]">
        <div>
          <div className="text-[56px] font-semibold leading-none" style={{ color: INK.primary }}>
            {fmtCount(head ? head.total : tt.ok)}
          </div>
          <div className="mt-[8px] flex items-center gap-[6px] text-[13px]" style={{ color: INK.secondary }}>
            <span className="h-[8px] w-[8px] rounded-full" style={{ background: color }} />
            {head ? head.label : p.doneRuns}
          </div>
          <div className="mt-[4px] text-[12px]">
            <Delta now={head ? head.total : tt.ok} prev={head ? head.prev : data.prev.ok} fmt={fmtCount} vs={vs} />
          </div>
        </div>
        {rest.map((m) => (
          <div key={m.key}>
            <div className="text-[24px] font-semibold leading-tight" style={{ color: INK.primary }}>
              {fmtCount(m.total)}
            </div>
            <div className="text-[12px]" style={{ color: INK.secondary }}>
              {m.label}
            </div>
            <div className="mt-[2px] text-[11.5px]">
              <Delta now={m.total} prev={m.prev} fmt={fmtCount} />
            </div>
          </div>
        ))}
        <span className="flex-1" />
        <div className="text-right text-[12px]" style={{ color: INK.secondary }}>
          {p.runsLine(tt.runs, pct(tt.ok, tt.runs), tt.avgSec === null ? null : fmtDur(tt.avgSec))}
        </div>
      </div>
      {!data.metrics.length && (
        <div className="mt-[12px]">
          <Empty>{p.noMetrics}</Empty>
        </div>
      )}
    </div>
  );
}

/** Próxima execução, pendências, tempo economizado e tokens. */
export function Status({ data }: { data: PipoDash }): React.JSX.Element {
  const saved = data.totals.ok ? Math.round(data.totals.savedMin / data.totals.ok) : 0;
  return (
    <div>
      <div className="grid grid-cols-4 gap-[12px]">
        <Kpi label={p.nextRun} value={data.pipo.paused ? p.paused : data.nextRunAt ? fmtDue(data.nextRunAt) : p.onDemand} sub={data.schedule ?? p.noSchedule} />
        <Kpi
          label={p.pending}
          value={String(data.pending.length)}
          accent={data.pending.some((x) => x.kind === 'approval') ? '#FCD34D' : undefined}
          sub={data.pending.length ? undefined : p.nothingPending}
        />
        <Kpi label={p.saved} value={data.totals.savedMin ? fmtHM(data.totals.savedMin) : '—'} sub={saved ? p.savedSub(saved) : p.savedMissing} />
        <Kpi label={p.tokens} value={fmtCount(data.totals.tokens)} sub={p.tokensSub(data.tokensPerRun === null ? null : fmtCount(data.tokensPerRun), fmtCount(data.month.tokens))} />
      </div>
      {data.pending.length > 0 && (
        <ul className="mt-[10px] flex flex-col gap-[4px] text-[12px]" style={{ color: INK.secondary }}>
          {data.pending.map((x, i) => (
            <li key={i} className="flex items-center gap-[8px]">
              <span style={{ color: x.kind === 'approval' ? '#FCD34D' : INK.muted }}>{x.kind === 'approval' ? '…' : '→'}</span>
              <span style={{ color: INK.primary }}>{x.kind === 'approval' ? p.waitingApproval(x.title) : p.inbox(x.title, x.runAfter ? fmtDue(x.runAfter) : null)}</span>
              <span style={{ color: INK.muted }}>{fmtDue(x.since)}</span>
              {x.runId !== null && <OpenRun pipoId={data.pipo.id} runId={x.runId} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpenRun({ pipoId, runId }: { pipoId: number; runId: number }): React.JSX.Element {
  return (
    <button type="button" onClick={() => void api.invoke('dash:openPipoRun', pipoId, runId)} className="rounded-full px-[8px] py-[1px] text-[11px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>
      {p.view}
    </button>
  );
}

/** A métrica em destaque (ou as execuções) por dia: uma série só, na primeira cor da paleta. */
export function OverTime({ data }: { data: PipoDash }): React.JSX.Element {
  const head = headlineOf(data);
  const week = data.range.kind === 'week';
  return (
    <BarChart
      data={data.days.map((x) => {
        const v = head ? (x.metrics[head.key] ?? 0) : x.runs;
        return {
          key: x.date,
          label: week ? WD[x.weekday] : ddmm(x.date),
          values: [v],
          tip: [`${WD[x.weekday]} ${ddmm(x.date)}`, head ? `${fmtCount(v)} ${head.label}` : p.runsUnit(x.runs), ...(head ? [p.runsUnit(x.runs)] : []), ...(x.failed ? [`${x.failed} ${x.failed === 1 ? 'falha' : 'falhas'}`] : [])],
        };
      })}
      colors={[SERIES[0]]}
      height={170}
      fmt={(v) => fmtCount(v)}
    />
  );
}

export function overTimeTable(data: PipoDash): { head: string[]; rows: Array<Array<string | number>> } {
  const head = headlineOf(data);
  return { head: ['Dia', ...(head ? [cap(head.label)] : []), 'Execuções', 'Falhas'], rows: data.days.map((x) => [ddmm(x.date), ...(head ? [x.metrics[head.key] ?? 0] : []), x.runs, x.failed]) };
}

/** Período atual contra o anterior, linha a linha. */
export function Compare({ data }: { data: PipoDash }): React.JSX.Element {
  const a = data.totals;
  const b = data.prev;
  const dur = (s: number | null): string => (s === null ? '—' : fmtDur(s));
  const rows: Array<{ label: string; now: string; before: string; delta: React.ReactNode }> = [
    ...data.metrics.map((m) => ({ label: m.label, now: fmtCount(m.total), before: fmtCount(m.prev), delta: <Delta now={m.total} prev={m.prev} fmt={fmtCount} /> })),
    { label: p.rowRuns, now: String(a.runs), before: String(b.runs), delta: <Delta now={a.runs} prev={b.runs} /> },
    { label: p.rowSuccess, now: a.runs ? `${pct(a.ok, a.runs)}%` : '—', before: b.runs ? `${pct(b.ok, b.runs)}%` : '—', delta: a.runs && b.runs ? <Delta now={pct(a.ok, a.runs) ?? 0} prev={pct(b.ok, b.runs) ?? 0} fmt={(v) => `${v} p.p.`} /> : null },
    { label: p.rowAvg, now: dur(a.avgSec), before: dur(b.avgSec), delta: a.avgSec !== null && b.avgSec !== null ? <Delta now={a.avgSec} prev={b.avgSec} upIsGood={false} fmt={fmtDur} /> : null },
    { label: p.rowTokens, now: fmtCount(a.tokens), before: fmtCount(b.tokens), delta: <Delta now={a.tokens} prev={b.tokens} upIsGood={false} fmt={fmtCount} /> },
    { label: p.rowSaved, now: fmtHM(a.savedMin), before: fmtHM(b.savedMin), delta: <Delta now={a.savedMin} prev={b.savedMin} fmt={fmtHM} /> },
  ];
  return (
    <table className="w-full text-left text-[12px]">
      <thead>
        <tr style={{ color: INK.secondary }}>
          <th className="pb-[6px] font-medium" />
          <th className="pb-[6px] text-right font-medium">{p.now}</th>
          <th className="pb-[6px] text-right font-medium">{p.before}</th>
          <th className="pb-[6px] pl-[14px] font-medium">{p.diff}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <td className="py-[5px]" style={{ color: INK.primary }}>
              {r.label}
            </td>
            <td className="mono py-[5px] text-right" style={{ color: INK.primary }}>
              {r.now}
            </td>
            <td className="mono py-[5px] text-right" style={{ color: INK.secondary }}>
              {r.before}
            </td>
            <td className="mono py-[5px] pl-[14px]">{r.delta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const stagesOf = (data: PipoDash): PipoDash['metrics'] => data.metrics.filter((m) => m.stage !== null).sort((a, b) => (a.stage as number) - (b.stage as number));

export function FunnelCard({ data, color }: { data: PipoDash; color: string }): React.JSX.Element {
  return <Funnel stages={stagesOf(data).map((m) => ({ label: m.label, value: m.total }))} color={color} />;
}

export function funnelTable(data: PipoDash): { head: string[]; rows: Array<Array<string | number>> } {
  const stages = stagesOf(data);
  return { head: ['Etapa', 'Total', '% da etapa anterior'], rows: stages.map((m, i) => [m.label, m.total, i > 0 && stages[i - 1].total > 0 ? `${Math.round((m.total / stages[i - 1].total) * 100)}%` : '']) };
}

/** Quantas execuções falharam, em que passo e por quê (o mesmo motivo é agrupado). */
export function Failures({ data }: { data: PipoDash }): React.JSX.Element {
  if (!data.failures.length) return <Empty>{p.noFailures}</Empty>;
  return (
    <div>
      <p className="mb-[8px] text-[12.5px]" style={{ color: INK.primary }}>
        {p.failedOf(data.totals.failed, data.totals.runs)}
      </p>
      <ul className="flex flex-col gap-[8px]">
        {data.failures.map((f) => (
          <li key={`${f.step}|${f.reason}`} className="grid grid-cols-[34px_1fr_auto] items-start gap-[8px] text-[12px]">
            <span className="mono" style={{ color: BAD }}>
              {f.count}×
            </span>
            <span className="min-w-0">
              <span style={{ color: INK.primary }}>{f.step ?? p.unknownStep}</span>
              <span className="block break-words" style={{ color: INK.secondary }}>
                {f.reason}
              </span>
            </span>
            <span className="flex items-center gap-[4px] whitespace-nowrap" style={{ color: INK.muted }}>
              {p.lastTime(fmtDue(f.lastAt))}
              <OpenRun pipoId={data.pipo.id} runId={f.lastRunId} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MEDIA_ICON: Record<PipoDashOutput['media'], string> = { video: '▶', image: '▣', audio: '♪', doc: '▤', other: '•', link: '↗' };

/** Arquivos e links que as execuções devolveram; um clique abre. */
export function Outputs({ data }: { data: PipoDash }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  if (!data.outputs.length)
    return (
      <div>
        <Empty>{p.noOutputs}</Empty>
        <p className="mt-[4px] text-[11.5px]" style={{ color: INK.muted }}>
          {p.outputsHint}
        </p>
      </div>
    );
  return (
    <div>
      <ul className="scroll-thin flex max-h-[280px] flex-col gap-[2px] overflow-y-auto">
        {data.outputs.map((o) => (
          <li key={`${o.runId}|${o.target}`}>
            <button
              type="button"
              title={o.target}
              onClick={() => void api.invoke('dash:openPipoOutput', data.pipo.id, o.runId, o.target).then((ok) => setFailed(ok ? null : o.target))}
              className="grid w-full grid-cols-[18px_1fr_auto] items-center gap-[8px] rounded-[8px] px-[8px] py-[5px] text-left text-[12px] hover:bg-white/[0.05]"
            >
              <span aria-label={p.media[o.media]} style={{ color: INK.secondary }}>
                {MEDIA_ICON[o.media]}
              </span>
              <span className="min-w-0">
                <span className="block truncate" style={{ color: INK.primary }}>
                  {o.label}
                </span>
                {failed === o.target && <span style={{ color: BAD }}>{p.openFailed}</span>}
              </span>
              <span className="whitespace-nowrap text-[11px]" style={{ color: INK.muted }}>
                {o.step ? `${o.step} · ` : ''}
                {fmtDue(o.at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.outputsMore > 0 && (
        <p className="mt-[6px] text-[11.5px]" style={{ color: INK.muted }}>
          {p.outputsMore(data.outputsMore)}
        </p>
      )}
    </div>
  );
}

const STATUS: Record<string, { icon: string; color: string }> = {
  done: { icon: '✓', color: GOOD },
  failed: { icon: '✕', color: BAD },
  cancelled: { icon: '–', color: INK.muted },
  running: { icon: '⟳', color: INK.primary },
  waiting: { icon: '…', color: '#FCD34D' },
  queued: { icon: '·', color: INK.muted },
};

/** Linha do tempo: quando rodou, quanto demorou e o que saiu. Clicar mostra a execução no notch. */
export function Timeline({ data }: { data: PipoDash }): React.JSX.Element {
  const [all, setAll] = useState(false);
  if (!data.runs.length) return <Empty>{p.noRuns}</Empty>;
  const shown = all ? data.runs : data.runs.slice(0, 12);
  return (
    <div>
      <ul className="flex flex-col gap-[2px]">
        {shown.map((r) => {
          const st = STATUS[r.status] ?? STATUS.queued;
          // Falhou: o erro já diz o passo ("Renderizar: …"). Senão, o resumo sem o nome do Pipo.
          const what = (r.status === 'failed' ? r.error : null) ?? r.summary?.replace(`${data.pipo.name}: `, '') ?? p.status[r.status] ?? r.status;
          return (
            <li key={r.id}>
              <button type="button" onClick={() => void api.invoke('dash:openPipoRun', data.pipo.id, r.id)} className="grid w-full grid-cols-[16px_104px_70px_1fr_auto] items-center gap-[10px] rounded-[8px] px-[8px] py-[5px] text-left text-[12px] hover:bg-white/[0.05]">
                <span aria-label={p.status[r.status] ?? r.status} style={{ color: st.color }}>
                  {st.icon}
                </span>
                <span style={{ color: INK.secondary }}>{fmtDue(r.startedAt)}</span>
                <span className="mono text-[11px]" style={{ color: INK.muted }}>
                  {r.durationSec === null ? '' : fmtDur(r.durationSec)}
                </span>
                <span className="truncate" style={{ color: INK.primary }} title={what}>
                  {what}
                </span>
                <span className="whitespace-nowrap text-[11px]" style={{ color: INK.muted }}>
                  {[t.team.trigger(r.trigger), r.outputs ? p.items(r.outputs) : null, r.tokens ? `${fmtCount(r.tokens)} tokens` : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!all && data.runs.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-[6px] rounded-full px-[10px] py-[2px] text-[11.5px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>
          {p.showAll(data.runs.length)}
        </button>
      )}
    </div>
  );
}

export function timelineTable(data: PipoDash): { head: string[]; rows: Array<Array<string | number>> } {
  return {
    head: ['Quando', 'Estado', 'Duração', 'Gatilho', ...data.metrics.map((m) => cap(m.label)), 'Itens', 'Tokens', 'Resumo'],
    rows: data.runs.map((r) => [new Date(r.startedAt).toLocaleString('pt-BR'), p.status[r.status] ?? r.status, r.durationSec === null ? '' : fmtDur(r.durationSec), t.team.trigger(r.trigger), ...data.metrics.map((m) => r.metrics[m.key] ?? 0), r.outputs, r.tokens, r.error ?? r.summary ?? '']),
  };
}
