// Estatísticas do dia (linha de status do Início, anel da meta, rodapé de Tarefas).
import type { CalendarEvent, DayStats } from '@shared/types';
import { db } from './db';
import { goalForDate, getProfile } from './db/repos/profile';
import { listTasks } from './db/repos/tasks';
import { dayKey, dayRange } from './time';

/** Ganchos preenchidos pelas fases seguintes (registro de atividade, agenda). */
export const statsHooks: {
  workedMin: ((start: string, end: string) => { workedMin: number; distractedMin: number }) | null;
  meetings: ((start: string, end: string) => { meetingMin: number; next: CalendarEvent | null }) | null;
} = { workedMin: null, meetings: null };

export function focusMinutes(start: string, end: string): { focusMin: number; distractedMin: number; completed: number } {
  const r = db().get<{ f: number | null; d: number | null; c: number | null }>(
    "SELECT SUM(focused_sec) AS f, SUM(distracted_sec) AS d, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS c FROM focus_sessions WHERE started_at >= ? AND started_at < ?",
    start,
    end,
  );
  return { focusMin: (r?.f ?? 0) / 60, distractedMin: (r?.d ?? 0) / 60, completed: r?.c ?? 0 };
}

export function statsFor(date: Date): DayStats {
  const { start, end } = dayRange(date);
  const f = focusMinutes(start, end);
  const worked = statsHooks.workedMin?.(start, end) ?? { workedMin: f.focusMin, distractedMin: f.distractedMin };
  const meetings = statsHooks.meetings?.(start, end) ?? { meetingMin: 0, next: null };
  const isToday = dayKey(date) === dayKey(new Date());
  const today = isToday ? listTasks('today') : [];
  return {
    date: dayKey(date),
    workedMin: Math.round(worked.workedMin),
    goalMin: goalForDate(getProfile(), date),
    focusMin: Math.round(f.focusMin),
    distractedMin: Math.round(worked.distractedMin),
    meetingMin: Math.round(meetings.meetingMin),
    plannedMin: today.reduce((acc, t) => acc + (t.estimateMin ?? 30), 0),
    openTodayTasks: today.length,
    focusSessionsCompleted: f.completed,
    nextMeeting: meetings.next,
  };
}

export function todayStats(): DayStats {
  return statsFor(new Date());
}
