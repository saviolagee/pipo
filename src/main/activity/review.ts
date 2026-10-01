// Relatórios de tempo: revisão do dia, agrupamentos e horas trabalhadas.
import type { ActivityBlock, DayReview, TimeReportRow } from '@shared/types';
import { db } from '../db';
import { blocksBetween } from '../db/repos/activity';
import { listClients } from '../db/repos/clients';
import { listTasks } from '../db/repos/tasks';
import { statsFor } from '../stats';
import { dayRange } from '../time';
import { computeWorkTime, type Interval } from './worktime';

const minutes = (b: ActivityBlock, from: string, to: string): number => {
  const s = Math.max(Date.parse(b.startedAt), Date.parse(from));
  const e = Math.min(Date.parse(b.endedAt), Date.parse(to));
  return Math.max(0, (e - s) / 60_000);
};

export function focusIntervals(from: string, to: string): Interval[] {
  const rows = db().all<{ started_at: string; ended_at: string | null }>('SELECT started_at, ended_at FROM focus_sessions WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)', to, from);
  const now = Date.now();
  return rows.map((r) => ({ start: Date.parse(r.started_at), end: r.ended_at ? Date.parse(r.ended_at) : now }));
}

export function workTime(from: string, to: string): { workedMin: number; distractedMin: number; meetingMin: number } {
  const blocks = blocksBetween(from, to);
  const range = { start: Date.parse(from), end: Math.min(Date.parse(to), Date.now()) };
  return computeWorkTime(
    range,
    blocks.map((b) => ({ start: Date.parse(b.startedAt), end: Date.parse(b.endedAt), category: b.category, idle: b.idle })),
    focusIntervals(from, to),
  );
}

export function timeReport(from: string, to: string, groupBy: 'client' | 'app' | 'day' | 'category'): TimeReportRow[] {
  const blocks = blocksBetween(from, to).filter((b) => !b.idle && b.category !== 'idle');
  const clients = new Map(listClients(true).map((c) => [c.id, c]));
  const acc = new Map<string, TimeReportRow>();
  const add = (key: string, label: string, min: number, color?: string): void => {
    const r = acc.get(key) ?? { key, label, minutes: 0, color };
    r.minutes += min;
    acc.set(key, r);
  };
  for (const b of blocks) {
    const m = minutes(b, from, to);
    if (groupBy === 'client') {
      if (b.category === 'distraction' || b.category === 'meeting') continue;
      const c = b.clientId ? clients.get(b.clientId) : undefined;
      add(c ? `c${c.id}` : 'none', c ? c.name : 'Sem cliente', m, c?.color ?? '#71717A');
    } else if (groupBy === 'app') {
      add(b.app, b.app, m, b.category === 'distraction' ? '#D9468F' : b.category === 'meeting' ? '#A78BFA' : '#3B82F6');
    } else if (groupBy === 'category') {
      add(b.category, b.category, m);
    } else {
      const d = new Date(b.startedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      add(key, key, m);
    }
  }
  return [...acc.values()].map((r) => ({ ...r, minutes: Math.round(r.minutes) })).filter((r) => r.minutes > 0).sort((a, b) => b.minutes - a.minutes);
}

export function dayReview(date = new Date()): DayReview {
  const { start, end } = dayRange(date);
  const stats = statsFor(date);
  const unclassified = blocksBetween(start, end).filter((b) => b.category === 'work' && Date.parse(b.endedAt) - Date.parse(b.startedAt) >= 5 * 60_000);
  return {
    stats,
    byClient: timeReport(start, end, 'client'),
    byApp: timeReport(start, end, 'app').slice(0, 6),
    pending: listTasks('today', date),
    unclassified,
    goalReached: stats.goalMin > 0 && stats.workedMin >= stats.goalMin,
  };
}
