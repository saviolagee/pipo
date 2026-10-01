// Padrões das últimas semanas (seção 9.9): no máximo 1 sugestão por semana.
import { WEEKDAYS_LONG } from '@shared/format';
import type { PatternSuggestion, Weekday, WeeklySummary } from '@shared/types';
import { timeReport } from '../activity/review';
import { db } from '../db';
import { listClients, norm } from '../db/repos/clients';
import { isNeutral } from '../db/repos/days';
import { statsFor } from '../stats';
import { addDays, dayRange } from '../time';

export interface PatternInput {
  tasks: Array<{ title: string; client: string | null; snoozeCount: number }>;
  sessions: Array<{ startedAt: string; completed: boolean; focusedSec: number }>;
  days: Array<{ date: string; weekday: Weekday; distractedMin: number; workedMin: number }>;
}

const STOP = new Set(['para', 'pelo', 'pela', 'com', 'sem', 'sobre', 'fazer', 'enviar', 'mandar', 'ligar', 'revisar', 'criar', 'ver', 'ler', 'das', 'dos', 'uma', 'umas', 'uns', 'que', 'mais', 'tarefa', 'tarefas']);

/** Grupo (cliente ou tema) que mais acumula adiamentos. */
export function mostSnoozed(tasks: PatternInput['tasks']): { group: string; snoozes: number; tasks: number } | null {
  const groups = new Map<string, { label: string; snoozes: number; tasks: number }>();
  const add = (key: string, label: string, n: number): void => {
    const g = groups.get(key) ?? { label, snoozes: 0, tasks: 0 };
    g.snoozes += n;
    g.tasks += 1;
    groups.set(key, g);
  };
  for (const t of tasks) {
    if (t.snoozeCount <= 0) continue;
    if (t.client) add(`c:${norm(t.client)}`, t.client, t.snoozeCount);
    for (const w of new Set(norm(t.title).split(/[^a-z0-9]+/).filter((x) => x.length >= 5 && !STOP.has(x)))) add(`w:${w}`, w, t.snoozeCount);
  }
  const best = [...groups.values()].filter((g) => g.snoozes >= 3 && g.tasks >= 2).sort((a, b) => b.snoozes - a.snoozes || b.tasks - a.tasks)[0];
  return best ? { group: best.label, snoozes: best.snoozes, tasks: best.tasks } : null;
}

/** Hora do dia com mais minutos de foco completo. */
export function bestFocusHour(sessions: PatternInput['sessions']): number | null {
  const byHour = new Map<number, number>();
  for (const s of sessions) {
    if (!s.completed) continue;
    const h = new Date(s.startedAt).getHours();
    byHour.set(h, (byHour.get(h) ?? 0) + s.focusedSec);
  }
  const best = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** Dia da semana com a maior proporção de tempo distraído. */
export function mostDistractedWeekday(days: PatternInput['days']): { weekday: Weekday; ratio: number } | null {
  const acc = new Map<Weekday, { d: number; w: number }>();
  for (const d of days) {
    const a = acc.get(d.weekday) ?? { d: 0, w: 0 };
    a.d += d.distractedMin;
    a.w += d.workedMin + d.distractedMin;
    acc.set(d.weekday, a);
  }
  const ranked = [...acc.entries()].filter(([, a]) => a.w > 60).map(([weekday, a]) => ({ weekday, ratio: a.d / a.w }));
  ranked.sort((a, b) => b.ratio - a.ratio);
  const top = ranked[0];
  const avg = ranked.reduce((x, r) => x + r.ratio, 0) / Math.max(1, ranked.length);
  return top && top.ratio > avg * 1.3 && top.ratio > 0.1 ? top : null;
}

/** Sugestões em ordem de utilidade. Exportado para testes. */
export function analyzePatterns(input: PatternInput): PatternSuggestion[] {
  const out: PatternSuggestion[] = [];
  const hour = bestFocusHour(input.sessions) ?? 9;
  const distracted = mostDistractedWeekday(input.days);
  const snoozed = mostSnoozed(input.tasks);
  if (snoozed) {
    // Bloco num dia que não seja o mais distraído (terça por padrão).
    const weekday: Weekday = distracted?.weekday === 2 ? 4 : 2;
    out.push({
      kind: snoozed.group === input.tasks.find((t) => t.client && norm(t.client) === norm(snoozed.group))?.client ? 'snoozed_client' : 'snoozed_word',
      text: `Você adia as tarefas de ${snoozed.group} toda semana. Bloqueio ${WEEKDAYS_LONG[weekday].replace('-feira', '')} ${hour}h–${hour + 1}h pra isso?`,
      block: { weekday, hour, durationMin: 60, title: `Foco: ${snoozed.group}` },
    });
  }
  if (input.sessions.filter((s) => s.completed).length >= 5) {
    out.push({ kind: 'best_hour', text: `Seu foco rende mais às ${hour}h. Quer que eu coloque as tarefas difíceis nesse horário?`, block: null });
  }
  if (distracted) {
    out.push({ kind: 'distracted_day', text: `${WEEKDAYS_LONG[distracted.weekday]} é seu dia mais distraído (${Math.round(distracted.ratio * 100)}% do tempo). Bora planejar tarefas mais curtas nesse dia?`, block: null });
  }
  return out;
}

export function patternInput(weeks: number, now = new Date()): PatternInput {
  const from = addDays(now, -7 * weeks).toISOString();
  const clients = new Map(listClients(true).map((c) => [c.id, c.name]));
  const tasks = db()
    .all<{ title: string; client_id: number | null; snooze_count: number }>('SELECT title, client_id, snooze_count FROM tasks WHERE created_at >= ? OR updated_at >= ?', from, from)
    .map((t) => ({ title: t.title, client: t.client_id ? (clients.get(t.client_id) ?? null) : null, snoozeCount: t.snooze_count }));
  const sessions = db()
    .all<{ started_at: string; status: string; focused_sec: number }>('SELECT started_at, status, focused_sec FROM focus_sessions WHERE started_at >= ?', from)
    .map((s) => ({ startedAt: s.started_at, completed: s.status === 'completed', focusedSec: s.focused_sec }));
  const days: PatternInput['days'] = [];
  for (let i = 1; i <= 7 * weeks; i++) {
    const d = addDays(now, -i);
    const st = statsFor(d);
    if (isNeutral(st.date)) continue;
    days.push({ date: st.date, weekday: d.getDay() as Weekday, distractedMin: st.distractedMin, workedMin: st.workedMin });
  }
  return { tasks, sessions, days };
}

export function patterns(weeks = 4): PatternSuggestion[] {
  return analyzePatterns(patternInput(weeks));
}

export function weeklySummary(now = new Date()): WeeklySummary {
  let worked = 0;
  let goal = 0;
  let distracted = 0;
  let sessions = 0;
  for (let i = 0; i < 7; i++) {
    const s = statsFor(addDays(now, -i));
    worked += s.workedMin;
    goal += s.goalMin;
    distracted += s.distractedMin;
    sessions += s.focusSessionsCompleted;
  }
  const from = dayRange(addDays(now, -6)).start;
  return { workedMin: worked, goalMin: goal, focusSessions: sessions, distractedMin: distracted, byClient: timeReport(from, new Date().toISOString(), 'client'), pattern: patterns(4)[0] ?? null };
}
