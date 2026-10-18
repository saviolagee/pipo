// Estatísticas do dia (linha de status do Início, anel da meta, rodapé de Tarefas).
import type { CalendarEvent, DayStats } from '@shared/types';
import { db } from './db';
import { actionsDoneOn } from './db/repos/goals';
import { offlineMinutes } from './db/repos/days';
import { goalForDate, getProfile } from './db/repos/profile';
import { listTasks } from './db/repos/tasks';
import { dayKey, dayRange } from './time';

/** Ganchos preenchidos pelas fases seguintes (registro de atividade, agenda). */
export const statsHooks: {
  workedMin: ((start: string, end: string) => { workedMin: number; distractedMin: number }) | null;
  meetings: ((start: string, end: string) => { meetingMin: number; next: CalendarEvent | null }) | null;
} = { workedMin: null, meetings: null };

/** Atividades feitas no período: tarefas concluídas mais ações da trilha. */
export function activitiesDone(start: string, end: string): { tasks: number; actions: number; total: number } {
  const tasks = db().get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?", start, end)?.n ?? 0;
  const actions = actionsDoneOn(start, end);
  return { tasks, actions, total: tasks + actions };
}

export function statsFor(date: Date): DayStats {
  const { start, end } = dayRange(date);
  const worked = statsHooks.workedMin?.(start, end) ?? { workedMin: 0, distractedMin: 0 };
  const meetings = statsHooks.meetings?.(start, end) ?? { meetingMin: 0, next: null };
  const isToday = dayKey(date) === dayKey(new Date());
  const today = isToday ? listTasks('today') : [];
  return {
    date: dayKey(date),
    // Horas informadas como "trabalhei fora do PC" somam às registradas.
    workedMin: Math.round(worked.workedMin + offlineMinutes(dayKey(date))),
    goalMin: goalForDate(getProfile(), date),
    distractedMin: Math.round(worked.distractedMin),
    meetingMin: Math.round(meetings.meetingMin),
    plannedMin: today.reduce((acc, t) => acc + (t.estimateMin ?? 30), 0),
    openTodayTasks: today.length,
    activitiesDone: activitiesDone(start, end).total,
    nextMeeting: meetings.next,
  };
}

export function todayStats(): DayStats {
  return statsFor(new Date());
}
