// Dados agregados dos dashboards (Fase 22). Tudo local; só agregados (nenhum título de janela).
import type { DashData, DashDay, DashRange } from '@shared/dashboard';
import { db } from '../db';
import { blocksBetween } from '../db/repos/activity';
import { listClients } from '../db/repos/clients';
import { dayStatus, NEUTRAL } from '../db/repos/days';
import { getProfile } from '../db/repos/profile';
import { getKV } from '../db/repos/settings';
import { getStreak } from '../insights/streak';
import { focusIntervals, timeReport } from '../activity/review';
import { activePlaybook, listPipos, listVersions } from '../pipos/repo';
import { statsFor } from '../stats';
import { addDays, dayKey, dayRange } from '../time';
import type { Weekday } from '@shared/types';

const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));

/** Período pronto (hoje, semana, mês, ano) a partir de uma data. */
export function rangeFor(kind: DashRange['kind'], ref = new Date()): DashRange {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (kind === 'today') return { kind, from: dayKey(d), to: dayKey(d) };
  if (kind === 'week') {
    const start = addDays(d, -((d.getDay() + 6) % 7));
    return { kind, from: dayKey(start), to: dayKey(addDays(start, 6)) };
  }
  if (kind === 'month') return { kind, from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  return { kind, from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}

export interface ClientEcon {
  hourlyRate?: number | null;
  monthlyValue?: number | null;
}

export function clientEcon(): Record<string, ClientEcon> {
  return getKV<Record<string, ClientEcon>>('clients:econ', {});
}

function daysOf(r: DashRange, today: Date): DashDay[] {
  const p = getProfile();
  const out: DashDay[] = [];
  const last = parse(r.to) > today ? today : parse(r.to);
  for (let d = parse(r.from); d <= last; d = addDays(d, 1)) {
    const st = statsFor(d);
    const { start, end } = dayRange(d);
    const done = db().get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?", start, end)?.n ?? 0;
    const created = db().get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE created_at >= ? AND created_at < ?', start, end)?.n ?? 0;
    const mood = db().get<{ mood: number }>('SELECT mood FROM mood_snapshots WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT 1', start, end)?.mood ?? null;
    const status = dayStatus(dayKey(d));
    const workday = !!p && p.workDays.includes(d.getDay() as Weekday);
    const absent = !!status && NEUTRAL.includes(status.kind) && status.kind !== 'no_record';
    out.push({
      date: dayKey(d),
      weekday: d.getDay(),
      workedMin: st.workedMin,
      goalMin: st.goalMin,
      focusMin: st.focusMin,
      distractedMin: st.distractedMin,
      meetingMin: st.meetingMin,
      tasksDone: done,
      tasksCreated: created,
      mood: status && NEUTRAL.includes(status.kind) ? null : mood,
      status: status?.kind ?? null,
      statusNote: status?.note ?? null,
      workday: workday && !absent,
      // Trabalho em folga/fim de semana conta como extra.
      extraMin: !workday || absent ? st.workedMin : 0,
    });
  }
  return out;
}

/** Minutos trabalhados por dia da semana × hora (o "quando você rende"). */
function rhythm(r: DashRange): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const from = parse(r.from).toISOString();
  const to = addDays(parse(r.to), 1).toISOString();
  const add = (s: number, e: number): void => {
    for (let t = s; t < e; ) {
      const d = new Date(t);
      const next = Math.min(e, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime());
      grid[d.getDay()][d.getHours()] += (next - t) / 60_000;
      t = next;
    }
  };
  for (const b of blocksBetween(from, to)) {
    if (b.idle || b.category === 'idle' || b.category === 'distraction' || b.category === 'meeting') continue;
    add(Date.parse(b.startedAt), Date.parse(b.endedAt));
  }
  // Sessões de foco sem registro de janela (ex.: sem permissão) também contam.
  if (!blocksBetween(from, to).length) for (const f of focusIntervals(from, to)) add(f.start, f.end);
  return grid.map((row) => row.map((m) => Math.round(m)));
}

function distractions(r: DashRange): Array<{ label: string; minutes: number }> {
  const from = parse(r.from).toISOString();
  const to = addDays(parse(r.to), 1).toISOString();
  const by = new Map<string, number>();
  for (const b of blocksBetween(from, to)) {
    if (b.category !== 'distraction') continue;
    let label = b.app;
    try {
      if (b.url) label = new URL(b.url).hostname.replace(/^www\./, '');
    } catch {
      // fica o app
    }
    by.set(label, (by.get(label) ?? 0) + (Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60_000);
  }
  return [...by.entries()]
    .map(([label, m]) => ({ label, minutes: Math.round(m) }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);
}

function clients(r: DashRange): DashData['clients'] {
  const from = parse(r.from).toISOString();
  const to = addDays(parse(r.to), 1).toISOString();
  const econ = clientEcon();
  const rows = timeReport(from, to, 'client');
  const all = listClients(true);
  const months = Math.max(1, (parse(r.to).getTime() - parse(r.from).getTime()) / (30.4 * 86_400_000));
  return rows
    .map((row) => {
      const c = all.find((x) => String(x.id) === row.key || x.name === row.label);
      const e = c ? econ[String(c.id)] : undefined;
      const hours = row.minutes / 60;
      // Valor do período: contrato mensal proporcional, ou horas × valor/hora.
      const contract = e?.monthlyValue ? e.monthlyValue * (r.kind === 'month' ? 1 : r.kind === 'year' ? 12 : months) : null;
      const value = contract ?? (e?.hourlyRate ? hours * e.hourlyRate : null);
      return {
        id: c?.id ?? null,
        name: row.label,
        color: c?.color ?? row.color ?? '#71717A',
        minutes: Math.round(row.minutes),
        hourlyRate: e?.hourlyRate ?? null,
        monthlyValue: e?.monthlyValue ?? null,
        value: value === null ? null : Math.round(value),
        effectiveRate: value !== null && hours > 0 ? Math.round(value / hours) : null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

function team(r: DashRange): DashData['team'] {
  const from = parse(r.from).toISOString();
  const to = addDays(parse(r.to), 1).toISOString();
  return listPipos()
    .filter((p) => p.activeVersion)
    .map((p) => {
      const runs = db().all<{ id: number; version: number; status: string; started_at: string; finished_at: string | null; metrics_json: string; error: string | null }>(
        'SELECT id, version, status, started_at, finished_at, metrics_json, error FROM pipo_runs WHERE pipo_id = ? AND dry_run = 0 AND started_at >= ? AND started_at < ? ORDER BY id',
        p.id,
        from,
        to,
      );
      const play = activePlaybook(p.id)?.playbook;
      const defs = play?.metrics ?? [];
      const totals: Record<string, number> = {};
      const byVersion = new Map<number, { runs: number; metrics: Record<string, number> }>();
      for (const run of runs) {
        const m = JSON.parse(run.metrics_json) as Record<string, number>;
        const v = byVersion.get(run.version) ?? { runs: 0, metrics: {} };
        v.runs++;
        for (const [k, n] of Object.entries(m)) {
          totals[k] = (totals[k] ?? 0) + n;
          v.metrics[k] = (v.metrics[k] ?? 0) + n;
        }
        byVersion.set(run.version, v);
      }
      const durations = runs.filter((x) => x.finished_at).map((x) => (Date.parse(x.finished_at as string) - Date.parse(x.started_at)) / 1000);
      const ok = runs.filter((x) => x.status === 'done').length;
      const lastFail = [...runs].reverse().find((x) => x.status === 'failed');
      return {
        pipoId: p.id,
        name: p.name,
        color: p.color,
        runs: runs.length,
        ok,
        failed: runs.filter((x) => x.status === 'failed').length,
        avgSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        savedMin: ok * (play?.savedMinutesPerRun ?? 0),
        lastFailure: lastFail ? { at: lastFail.started_at, error: lastFail.error } : null,
        metrics: defs.map((m) => ({ key: m.key, label: m.label, stage: m.stage ?? null, total: totals[m.key] ?? 0 })),
        versions: [...byVersion.entries()].map(([version, v]) => ({ version, runs: v.runs, metrics: v.metrics, changelog: listVersions(p.id).find((x) => x.version === version)?.changelog ?? '' })),
      };
    });
}

/** Dinheiro da Stripe por dia no período (preenchido pelo módulo da Stripe). */
export const dashHooks: { money: ((from: Date, to: Date) => Promise<DashData['money']>) | null } = { money: null };

export async function dashboardData(r: DashRange, now = new Date()): Promise<DashData> {
  const days = daysOf(r, now);
  const sum = (k: keyof DashDay): number => days.reduce((a, d) => a + (typeof d[k] === 'number' ? (d[k] as number) : 0), 0);
  const money = dashHooks.money ? await dashHooks.money(parse(r.from), addDays(parse(r.to), 1)).catch(() => null) : null;
  const s = getStreak();
  return {
    range: r,
    totals: {
      workedMin: sum('workedMin'),
      goalMin: sum('goalMin'),
      focusMin: sum('focusMin'),
      distractedMin: sum('distractedMin'),
      meetingMin: sum('meetingMin'),
      tasksDone: sum('tasksDone'),
      tasksCreated: sum('tasksCreated'),
      extraMin: sum('extraMin'),
      daysWorked: days.filter((d) => d.workedMin >= 30).length,
      daysOff: days.filter((d) => d.status === 'off' || d.status === 'sick').length,
      vacationDays: days.filter((d) => d.status === 'vacation').length,
      holidays: days.filter((d) => d.status === 'holiday').length,
      goalDays: days.filter((d) => d.goalMin > 0 && d.workedMin >= d.goalMin * 0.8).length,
      moodAvg: (() => {
        const m = days.map((d) => d.mood).filter((x): x is number => x !== null);
        return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null;
      })(),
    },
    days,
    rhythm: rhythm(r),
    distractions: distractions(r),
    clients: clients(r),
    team: team(r),
    money,
    streak: { current: s.currentDays, best: s.bestDays },
  };
}
