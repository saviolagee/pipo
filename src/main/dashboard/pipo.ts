// Painel de cada Pipo: o que ele fez e o que resultou, a partir das métricas do plano dele. Traz
// resultados (com a métrica principal em destaque), linha do tempo, falhas e motivos, o que ele
// produziu, custo em tokens, tempo economizado, pendências, próxima execução e a comparação com o
// período anterior. Tudo sai do que o executor já grava (pipo_runs, pipo_run_steps e runs/<id>/).
import { normalizePipoConfig, type DashRange, type PipoDash, type PipoDashConfig, type PipoDashOutput, type PipoDashRun, type PipoDashTotals } from '@shared/dashboard';
import type { MetricDef } from '@shared/pipos';
import { db } from '../db';
import { getKV, setKV } from '../db/repos/settings';
import { activePlaybook, getPipo, pipoDir, runSteps } from '../pipos/repo';
import { addDays, dayKey } from '../time';
import { rangeFor } from './data';
import { collectOutputs } from './pipo-outputs';

const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86_400_000);

/** Preenchido pelos gatilhos: próxima execução agendada e como o usuário descreveu a agenda. */
export const pipoDashHooks: { next: (pipoId: number) => { at: string | null; label: string | null } } = { next: () => ({ at: null, label: null }) };

const MAX_RUNS = 200;
const MAX_OUTPUT_RUNS = 40;
const MAX_OUTPUTS = 60;

/**
 * Período anterior do mesmo tamanho. Se o período atual ainda está em andamento, compara com o
 * mesmo trecho do anterior (até quarta contra até quarta), para a comparação ser justa.
 */
export function prevRange(r: DashRange, now = new Date()): DashRange {
  const a = parse(r.from);
  const len = daysBetween(a, parse(r.to)) + 1;
  let prev: DashRange;
  if (r.kind === 'today') prev = rangeFor('today', addDays(a, -1));
  else if (r.kind === 'week') prev = rangeFor('week', addDays(a, -7));
  else if (r.kind === 'month') prev = rangeFor('month', new Date(a.getFullYear(), a.getMonth() - 1, 1));
  else if (r.kind === 'year') prev = rangeFor('year', new Date(a.getFullYear() - 1, 0, 1));
  else prev = { kind: 'custom', from: dayKey(addDays(a, -len)), to: dayKey(addDays(a, -1)) };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsed = daysBetween(a, today) + 1;
  if (elapsed >= 1 && elapsed < len) {
    const cut = addDays(parse(prev.from), elapsed - 1);
    if (cut < parse(prev.to)) prev = { ...prev, to: dayKey(cut) };
  }
  return prev;
}

export function getPipoConfig(pipoId: number): PipoDashConfig {
  return normalizePipoConfig(getKV<Partial<PipoDashConfig> | null>(`pipo:dash:${pipoId}`, null));
}

export function setPipoConfig(pipoId: number, config: Partial<PipoDashConfig>): PipoDashConfig {
  const c = normalizePipoConfig(config);
  setKV(`pipo:dash:${pipoId}`, c);
  return c;
}

/** Métrica em destaque: a escolhida pelo usuário, a principal do plano, o fim do funil ou a primeira. */
export function headlineKey(defs: MetricDef[], chosen: string | null): string | null {
  if (chosen && defs.some((m) => m.key === chosen)) return chosen;
  const main = defs.find((m) => m.main);
  if (main) return main.key;
  const staged = defs.filter((m) => typeof m.stage === 'number').sort((a, b) => (b.stage as number) - (a.stage as number));
  return staged[0]?.key ?? defs[0]?.key ?? null;
}

interface Row {
  id: number;
  version: number;
  trigger: string;
  status: string;
  dry_run: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  metrics_json: string;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
}

function rowsIn(pipoId: number, r: DashRange): Row[] {
  return db().all<Row>(
    'SELECT id, version, trigger, status, dry_run, started_at, finished_at, summary, metrics_json, error, tokens_in, tokens_out FROM pipo_runs WHERE pipo_id = ? AND started_at >= ? AND started_at < ? ORDER BY id',
    pipoId,
    parse(r.from).toISOString(),
    addDays(parse(r.to), 1).toISOString(),
  );
}

const metricsOf = (row: Row): Record<string, number> => {
  try {
    return JSON.parse(row.metrics_json) as Record<string, number>;
  } catch {
    return {};
  }
};

const tokensOf = (row: Row): number => (row.tokens_in ?? 0) + (row.tokens_out ?? 0);

function totalsOf(rows: Row[], savedPerRun: number): PipoDashTotals {
  const real = rows.filter((x) => !x.dry_run);
  const durations = real.filter((x) => x.finished_at).map((x) => (Date.parse(x.finished_at as string) - Date.parse(x.started_at)) / 1000);
  const ok = real.filter((x) => x.status === 'done').length;
  const metrics: Record<string, number> = {};
  for (const row of real) for (const [k, n] of Object.entries(metricsOf(row))) metrics[k] = (metrics[k] ?? 0) + n;
  return {
    runs: real.length,
    ok,
    failed: real.filter((x) => x.status === 'failed').length,
    cancelled: real.filter((x) => x.status === 'cancelled').length,
    avgSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    savedMin: ok * savedPerRun,
    // Ensaios também chamam o agente, então entram no custo.
    tokens: rows.reduce((a, x) => a + tokensOf(x), 0),
    metrics,
  };
}

/** Mesmo erro com números diferentes ("3 falharam", "5 falharam") conta como um motivo só. */
const reasonKey = (s: string): string => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 140);

function failuresOf(rows: Row[]): { list: PipoDash['failures']; stepByRun: Map<number, string> } {
  const groups = new Map<string, PipoDash['failures'][number]>();
  const stepByRun = new Map<number, string>();
  for (const row of rows) {
    if (row.dry_run || row.status !== 'failed') continue;
    const s = db().get<{ title: string; error: string | null }>("SELECT title, error FROM pipo_run_steps WHERE run_id = ? AND status = 'failed' ORDER BY id LIMIT 1", row.id);
    const step = s?.title ?? null;
    if (step) stepByRun.set(row.id, step);
    const raw = s?.error ?? (step && row.error?.startsWith(`${step}: `) ? row.error.slice(step.length + 2) : row.error) ?? 'Erro sem descrição.';
    const k = `${step ?? ''}|${reasonKey(raw)}`;
    const g = groups.get(k);
    // As linhas vêm em ordem: a última vista é a mais recente.
    if (g) groups.set(k, { ...g, count: g.count + 1, reason: raw.slice(0, 220), lastAt: row.started_at, lastRunId: row.id });
    else groups.set(k, { reason: raw.slice(0, 220), step, count: 1, lastAt: row.started_at, lastRunId: row.id });
  }
  return { list: [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)), stepByRun };
}

function pendingOf(pipoId: number): PipoDash['pending'] {
  const approvals = db().all<{ run_id: number; title: string; since: string }>(
    `SELECT s.run_id, s.title, COALESCE(s.started_at, r.started_at) AS since
       FROM pipo_run_steps s JOIN pipo_runs r ON r.id = s.run_id
      WHERE r.pipo_id = ? AND r.dry_run = 0 AND r.status IN ('running', 'waiting') AND s.status = 'waiting' ORDER BY s.id`,
    pipoId,
  );
  const inbox = db().all<{ run_after: string | null; created_at: string; name: string | null }>(
    `SELECT i.run_after, i.created_at, p.name
       FROM pipo_inbox i LEFT JOIN pipo_runs r ON r.id = i.from_run_id LEFT JOIN pipos p ON p.id = r.pipo_id
      WHERE i.to_pipo_id = ? AND i.status = 'pending' ORDER BY i.id`,
    pipoId,
  );
  return [
    ...approvals.map((a) => ({ kind: 'approval' as const, runId: a.run_id, title: a.title, since: a.since, runAfter: null })),
    ...inbox.map((i) => ({ kind: 'inbox' as const, runId: null, title: i.name ?? '', since: i.created_at, runAfter: i.run_after })),
  ];
}

export function pipoDashboard(pipoId: number, r: DashRange, now = new Date()): PipoDash | null {
  const p = getPipo(pipoId);
  if (!p) return null;
  const play = activePlaybook(p.id)?.playbook ?? null;
  const defs = play?.metrics ?? [];
  const saved = play?.savedMinutesPerRun ?? 0;
  const config = getPipoConfig(p.id);
  const headline = headlineKey(defs, config.headline);
  const prevR = prevRange(r, now);
  const rows = rowsIn(p.id, r);
  const totals = totalsOf(rows, saved);
  const prev = totalsOf(rowsIn(p.id, prevR), saved);
  const real = rows.filter((x) => !x.dry_run);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = parse(r.to) > today ? today : parse(r.to);
  const byDay = new Map<string, PipoDash['days'][number]>();
  for (let d = parse(r.from); d <= last; d = addDays(d, 1)) byDay.set(dayKey(d), { date: dayKey(d), weekday: d.getDay(), runs: 0, ok: 0, failed: 0, metrics: {} });
  for (const row of real) {
    const day = byDay.get(dayKey(new Date(row.started_at)));
    if (!day) continue;
    day.runs++;
    if (row.status === 'done') day.ok++;
    if (row.status === 'failed') day.failed++;
    for (const [k, n] of Object.entries(metricsOf(row))) day.metrics[k] = (day.metrics[k] ?? 0) + n;
  }

  // O que ele produziu: das execuções mais novas para as mais antigas, até encher a galeria.
  const dir = pipoDir(p.slug);
  const outputs: PipoDashOutput[] = [];
  const outputCount = new Map<number, number>();
  let outputsMore = 0;
  const scanned = [...real].reverse().filter((x) => x.status === 'done' || x.status === 'failed').slice(0, MAX_OUTPUT_RUNS);
  for (const row of scanned) {
    const found = collectOutputs(dir, row.id, row.started_at, runSteps(row.id).map((s) => ({ key: s.key, title: s.title })));
    outputCount.set(row.id, found.items.length + found.more);
    const room = Math.max(0, MAX_OUTPUTS - outputs.length);
    outputs.push(...found.items.slice(0, room));
    outputsMore += found.more + Math.max(0, found.items.length - room);
  }

  const { list: failures, stepByRun } = failuresOf(rows);
  const runs: PipoDashRun[] = [...real]
    .reverse()
    .slice(0, MAX_RUNS)
    .map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      durationSec: row.finished_at ? Math.max(0, Math.round((Date.parse(row.finished_at) - Date.parse(row.started_at)) / 1000)) : null,
      trigger: row.trigger,
      status: row.status,
      version: row.version,
      summary: row.summary,
      error: row.error,
      failedStep: stepByRun.get(row.id) ?? null,
      metrics: metricsOf(row),
      tokens: tokensOf(row),
      outputs: outputCount.get(row.id) ?? 0,
    }));

  const monthRows = rowsIn(p.id, rangeFor('month', now));
  const withTokens = real.filter((x) => x.finished_at && tokensOf(x) > 0);
  const next = pipoDashHooks.next(p.id);
  return {
    range: r,
    prevRange: prevR,
    pipo: { id: p.id, slug: p.slug, name: p.name, color: p.color, accessory: p.accessory, mission: p.personality.mission, paused: p.paused, version: p.activeVersion },
    config,
    metrics: defs.map((m) => ({ key: m.key, label: m.label, stage: m.stage ?? null, total: totals.metrics[m.key] ?? 0, prev: prev.metrics[m.key] ?? 0, headline: m.key === headline })),
    totals,
    prev,
    days: [...byDay.values()],
    runs,
    failures,
    outputs,
    outputsMore,
    pending: pendingOf(p.id),
    nextRunAt: next.at,
    schedule: next.label,
    month: { tokens: monthRows.reduce((a, x) => a + tokensOf(x), 0), runs: monthRows.filter((x) => !x.dry_run).length },
    tokensPerRun: withTokens.length ? Math.round(withTokens.reduce((a, x) => a + tokensOf(x), 0) / withTokens.length) : null,
  };
}
