// Tipos dos dashboards (Fase 22).
import type { DayKind } from './types';

export interface DashRange {
  kind: 'today' | 'week' | 'month' | 'year' | 'custom';
  /** AAAA-MM-DD, inclusive. */
  from: string;
  to: string;
}

export interface DashDay {
  date: string;
  weekday: number;
  workedMin: number;
  goalMin: number;
  focusMin: number;
  distractedMin: number;
  meetingMin: number;
  tasksDone: number;
  tasksCreated: number;
  mood: number | null;
  status: DayKind | null;
  statusNote: string | null;
  /** Dia útil de verdade (não é folga/férias/feriado). */
  workday: boolean;
  /** Trabalhado em folga/fim de semana. */
  extraMin: number;
}

export interface DashPipo {
  pipoId: number;
  name: string;
  color: string;
  runs: number;
  ok: number;
  failed: number;
  avgSec: number | null;
  savedMin: number;
  lastFailure: { at: string; error: string | null } | null;
  metrics: Array<{ key: string; label: string; stage: number | null; total: number }>;
  versions: Array<{ version: number; runs: number; metrics: Record<string, number>; changelog: string }>;
}

export interface DashData {
  range: DashRange;
  totals: {
    workedMin: number;
    goalMin: number;
    focusMin: number;
    distractedMin: number;
    meetingMin: number;
    tasksDone: number;
    tasksCreated: number;
    extraMin: number;
    daysWorked: number;
    daysOff: number;
    vacationDays: number;
    holidays: number;
    goalDays: number;
    moodAvg: number | null;
  };
  days: DashDay[];
  /** [dia da semana 0–6][hora 0–23] = minutos trabalhados. */
  rhythm: number[][];
  distractions: Array<{ label: string; minutes: number }>;
  clients: Array<{ id: number | null; name: string; color: string; minutes: number; hourlyRate: number | null; monthlyValue: number | null; value: number | null; effectiveRate: number | null }>;
  team: DashPipo[];
  money: { currency: string; total: number; days: Array<{ date: string; amount: number }> } | null;
  streak: { current: number; best: number };
}
