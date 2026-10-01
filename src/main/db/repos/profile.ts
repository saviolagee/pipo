import { PRESENCE_BUDGET } from '@shared/config';
import type { FocusPreset, Profile, Weekday } from '@shared/types';
import { db } from '../index';
import { goalFactor } from './days';

interface ProfileRow {
  name: string;
  work_days_json: string;
  start_time: string;
  end_time: string;
  lunch_start: string;
  lunch_min: number;
  daily_goal_min: number;
  goal_per_day_json: string | null;
  energy_peak: Profile['energyPeak'];
  focus_preset_json: string;
  presence_level: Profile['presenceLevel'];
  interrupt_budget: number;
  tone: Profile['tone'];
  autostart: number;
  onboarded_at: string | null;
}

export const FOCUS_PRESETS: Record<Exclude<FocusPreset['id'], 'custom'>, FocusPreset> = {
  p25: { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 },
  p50: { id: 'p50', focusMin: 50, breakMin: 10, longBreakMin: 20, cycles: 3 },
  deep90: { id: 'deep90', focusMin: 90, breakMin: 20, longBreakMin: 30, cycles: 2 },
};

export function defaultProfile(): Profile {
  return {
    name: '',
    workDays: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '18:00',
    lunchStart: '12:00',
    lunchMin: 60,
    dailyGoalMin: 360,
    goalPerDay: null,
    energyPeak: 'morning',
    focusPreset: { ...FOCUS_PRESETS.p25 },
    presenceLevel: 'balanced',
    interruptBudget: PRESENCE_BUDGET.balanced,
    tone: 'cute',
    autostart: true,
    onboardedAt: null,
  };
}

export function getProfile(): Profile | null {
  const r = db().get<ProfileRow>('SELECT * FROM profile WHERE id = 1');
  if (!r) return null;
  return {
    name: r.name,
    workDays: JSON.parse(r.work_days_json) as Weekday[],
    startTime: r.start_time,
    endTime: r.end_time,
    lunchStart: r.lunch_start,
    lunchMin: r.lunch_min,
    dailyGoalMin: r.daily_goal_min,
    goalPerDay: r.goal_per_day_json ? (JSON.parse(r.goal_per_day_json) as Profile['goalPerDay']) : null,
    energyPeak: r.energy_peak,
    focusPreset: JSON.parse(r.focus_preset_json) as FocusPreset,
    presenceLevel: r.presence_level,
    interruptBudget: r.interrupt_budget,
    tone: r.tone,
    autostart: !!r.autostart,
    onboardedAt: r.onboarded_at,
  };
}

export function saveProfile(p: Profile): Profile {
  db().run(
    `INSERT INTO profile (id, name, work_days_json, start_time, end_time, lunch_start, lunch_min, daily_goal_min,
       goal_per_day_json, energy_peak, focus_preset_json, presence_level, interrupt_budget, tone, autostart, onboarded_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, work_days_json = excluded.work_days_json, start_time = excluded.start_time,
       end_time = excluded.end_time, lunch_start = excluded.lunch_start, lunch_min = excluded.lunch_min,
       daily_goal_min = excluded.daily_goal_min, goal_per_day_json = excluded.goal_per_day_json,
       energy_peak = excluded.energy_peak, focus_preset_json = excluded.focus_preset_json,
       presence_level = excluded.presence_level, interrupt_budget = excluded.interrupt_budget,
       tone = excluded.tone, autostart = excluded.autostart, onboarded_at = excluded.onboarded_at`,
    p.name.trim(),
    JSON.stringify(p.workDays),
    p.startTime,
    p.endTime,
    p.lunchStart,
    p.lunchMin,
    p.dailyGoalMin,
    p.goalPerDay ? JSON.stringify(p.goalPerDay) : null,
    p.energyPeak,
    JSON.stringify(p.focusPreset),
    p.presenceLevel,
    p.interruptBudget,
    p.tone,
    p.autostart,
    p.onboardedAt,
  );
  return getProfile() as Profile;
}

export function resetOnboarding(): void {
  db().run('UPDATE profile SET onboarded_at = NULL WHERE id = 1');
}

/** Meta de minutos para um dia específico (respeita a meta por dia e dias de folga). */
export function goalForDate(p: Profile | null, d: Date): number {
  if (!p) return 360;
  const wd = d.getDay() as Weekday;
  const base = p.goalPerDay && p.goalPerDay[wd] !== undefined ? (p.goalPerDay[wd] ?? 0) : p.workDays.includes(wd) ? p.dailyGoalMin : 0;
  // Folga/férias/feriado/doente zeram a meta; meio período corta pela metade (Fase 15).
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return Math.round(base * goalFactor(key));
}
