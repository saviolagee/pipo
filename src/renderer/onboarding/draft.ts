import { DEFAULT_DISTRACTIONS, PRESENCE_BUDGET } from '@shared/config';
import type { Client, DistractionSettings, FocusPreset, Profile, Ritual } from '@shared/types';

export type DraftClient = Omit<Client, 'id'> & { id?: number };

export interface Draft {
  profile: Profile;
  rituals: Omit<Ritual, 'id'>[];
  clients: DraftClient[];
  distractions: DistractionSettings;
}

export interface StepProps {
  draft: Draft;
  set: (fn: (d: Draft) => Draft) => void;
}

export const PRESETS: Record<Exclude<FocusPreset['id'], 'custom'>, FocusPreset> = {
  p25: { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 },
  p50: { id: 'p50', focusMin: 50, breakMin: 10, longBreakMin: 20, cycles: 3 },
  deep90: { id: 'deep90', focusMin: 90, breakMin: 20, longBreakMin: 30, cycles: 2 },
};

export function defaultDraft(): Draft {
  return {
    profile: {
      name: '',
      workDays: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '18:00',
      lunchStart: '12:00',
      lunchMin: 60,
      dailyGoalMin: 360,
      goalPerDay: null,
      energyPeak: 'morning',
      focusPreset: { ...PRESETS.p25 },
      presenceLevel: 'balanced',
      interruptBudget: PRESENCE_BUDGET.balanced,
      tone: 'cute',
      autostart: true,
      onboardedAt: null,
    },
    rituals: [],
    clients: [],
    distractions: { items: [...DEFAULT_DISTRACTIONS], toleranceSec: 60, allowed: [] },
  };
}

export const setProfile =
  (patch: Partial<Profile>) =>
  (d: Draft): Draft => ({ ...d, profile: { ...d.profile, ...patch } });

export function fmtGoal(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
