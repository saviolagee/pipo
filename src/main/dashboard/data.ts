// Dados agregados dos dashboards (Fase 22): contados pelo que foi feito (tarefas concluídas e ações
// da trilha), dia a dia. Tudo local.
import { longestRun, type DashActivity, type DashData, type DashDay, type DashRange } from '@shared/dashboard';
import type { Weekday } from '@shared/types';
import { db } from '../db';
import { listClients } from '../db/repos/clients';
import { dayStatus, NEUTRAL } from '../db/repos/days';
import { getProfile } from '../db/repos/profile';
import { getStreak } from '../insights/streak';
import { activePlaybook, listPipos, listVersions } from '../pipos/repo';
import { addDays, dayKey, dayRange } from '../time';

const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const MAX_ACTIVITIES = 300;

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

/** Do começo do período até o fim dele (ou até agora, se o período ainda não acabou). */
function bounds(r: DashRange, now: Date): { from: string; to: string; last: Date } {
  const end = addDays(parse(r.to), 1);
  const last = parse(r.to) > now ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : parse(r.to);
  return { from: parse(r.from).toISOString(), to: (end > now ? now : end).toISOString(), last };
}

/** Tudo o que foi feito no período: tarefas concluídas e ações da trilha, da mais nova para a mais antiga. */
function doneBetween(from: string, to: string): DashActivity[] {
  const clients = new Map(listClients(true).map((c) => [c.id, c]));
  const tasks = db()
    .all<{ at: string; title: string; client_id: number | null }>("SELECT completed_at AS at, title, client_id FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?", from, to)
    .map((t): DashActivity => {
      const c = t.client_id ? clients.get(t.client_id) : undefined;
      return { at: t.at, date: dayKey(new Date(t.at)), kind: 'task', title: t.title, where: c?.name ?? null, color: c?.color ?? null };
    });
  const actions = db()
    .all<{ at: string; title: string; goal: string }>('SELECT a.done_at AS at, a.title, g.title AS goal FROM goal_actions a JOIN goals g ON g.id = a.goal_id WHERE a.done_at >= ? AND a.done_at < ?', from, to)
    .map((a): DashActivity => ({ at: a.at, date: dayKey(new Date(a.at)), kind: 'action', title: a.title, where: a.goal, color: null }));
  return [...tasks, ...actions].sort((a, b) => b.at.localeCompare(a.at));
}

function daysOf(r: DashRange, last: Date, done: DashActivity[]): DashDay[] {
  const p = getProfile();
  const out: DashDay[] = [];
  for (let d = parse(r.from); d <= last; d = addDays(d, 1)) {
    const key = dayKey(d);
    const { start, end } = dayRange(d);
    const today = done.filter((x) => x.date === key);
    const created = db().get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE created_at >= ? AND created_at < ?', start, end)?.n ?? 0;
    const mood = db().get<{ mood: number }>('SELECT mood FROM mood_snapshots WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT 1', start, end)?.mood ?? null;
    const status = dayStatus(key);
    const absent = !!status && NEUTRAL.includes(status.kind) && status.kind !== 'no_record';
    out.push({
      date: key,
      weekday: d.getDay(),
      done: today.length,
      tasksDone: today.filter((x) => x.kind === 'task').length,
      actionsDone: today.filter((x) => x.kind === 'action').length,
      created,
      mood: status && NEUTRAL.includes(status.kind) ? null : mood,
      status: status?.kind ?? null,
      statusNote: status?.note ?? null,
      workday: !!p && p.workDays.includes(d.getDay() as Weekday) && !absent,
    });
  }
  return out;
}

/** Atividades feitas por dia da semana × hora (o "quando você faz"). */
function rhythm(done: DashActivity[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const a of done) {
    const d = new Date(a.at);
    grid[d.getDay()][d.getHours()]++;
  }
  return grid;
}

/** Atividades feitas por cliente no período, e quantas ainda estão abertas. */
function clients(done: DashActivity[]): DashData['clients'] {
  const open = new Map(db().all<{ id: number | null; n: number }>("SELECT client_id AS id, COUNT(*) AS n FROM tasks WHERE status != 'done' GROUP BY client_id").map((x) => [x.id, x.n]));
  const rows: DashData['clients'] = listClients(true).map((c) => ({ id: c.id, name: c.name, color: c.color, done: done.filter((a) => a.kind === 'task' && a.where === c.name).length, open: open.get(c.id) ?? 0 }));
  rows.push({ id: null, name: 'Sem cliente', color: '#71717A', done: done.filter((a) => a.kind === 'task' && !a.where).length, open: open.get(null) ?? 0 });
  return rows
    .filter((c) => c.done > 0 || c.open > 0)
    .sort((a, b) => b.done - a.done || b.open - a.open);
}

/** Planos da trilha que andaram no período ou ainda estão ativos. */
function goals(from: string, to: string): DashData['goals'] {
  return db()
    .all<{ id: number; title: string; status: string; total: number; done: number; in_range: number }>(
      `SELECT g.id, g.title, g.status, COUNT(a.id) AS total, SUM(CASE WHEN a.done_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN a.done_at >= ? AND a.done_at < ? THEN 1 ELSE 0 END) AS in_range
         FROM goals g LEFT JOIN goal_actions a ON a.goal_id = g.id GROUP BY g.id ORDER BY g.id`,
      from,
      to,
    )
    .filter((g) => g.status === 'active' || g.in_range > 0)
    .map((g) => ({ id: g.id, title: g.title, status: g.status, doneInRange: g.in_range ?? 0, done: g.done ?? 0, total: g.total }));
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
  const b = bounds(r, now);
  const done = b.last < parse(r.from) ? [] : doneBetween(b.from, b.to);
  const days = b.last < parse(r.from) ? [] : daysOf(r, b.last, done);
  const money = dashHooks.money ? await dashHooks.money(parse(r.from), addDays(parse(r.to), 1)).catch(() => null) : null;
  const s = getStreak();
  const active = days.filter((d) => d.done > 0);
  const best = [...active].sort((a, b) => b.done - a.done || b.date.localeCompare(a.date))[0] ?? null;
  const moods = days.map((d) => d.mood).filter((x): x is number => x !== null);
  return {
    range: r,
    totals: {
      done: done.length,
      tasksDone: done.filter((a) => a.kind === 'task').length,
      actionsDone: done.filter((a) => a.kind === 'action').length,
      created: days.reduce((a, d) => a + d.created, 0),
      activeDays: active.length,
      workdays: days.filter((d) => d.workday).length,
      activeWorkdays: days.filter((d) => d.workday && d.done > 0).length,
      perActiveDay: active.length ? Math.round((done.length / active.length) * 10) / 10 : 0,
      bestDay: best ? { date: best.date, done: best.done } : null,
      longestRun: longestRun(days),
      daysOff: days.filter((d) => d.status === 'off' || d.status === 'sick').length,
      vacationDays: days.filter((d) => d.status === 'vacation').length,
      holidays: days.filter((d) => d.status === 'holiday').length,
      moodAvg: moods.length ? Math.round(moods.reduce((a, x) => a + x, 0) / moods.length) : null,
    },
    days,
    rhythm: rhythm(done),
    activities: done.slice(0, MAX_ACTIVITIES),
    activitiesMore: Math.max(0, done.length - MAX_ACTIVITIES),
    clients: clients(done),
    goals: goals(b.from, b.to),
    team: team(r),
    money,
    streak: { current: s.currentDays, best: s.bestDays },
  };
}
