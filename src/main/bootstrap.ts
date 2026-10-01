import type { Bootstrap, DayStats } from '@shared/types';
import { getSettings } from './db/repos/settings';
import { handle } from './ipc';

/** Valores provisórios da Fase 2 (substituídos pelos dados reais nas fases seguintes). */
function mockStats(): DayStats {
  return {
    date: new Date().toISOString().slice(0, 10),
    workedMin: 192,
    goalMin: 360,
    focusMin: 120,
    distractedMin: 12,
    meetingMin: 60,
    plannedMin: 270,
    openTodayTasks: 4,
    focusSessionsCompleted: 2,
    nextMeeting: { id: 'mock', title: 'Daily', start: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(), end: new Date(new Date().setHours(14, 30, 0, 0)).toISOString(), meetingUrl: null },
  };
}

export function registerBootstrapIpc(): void {
  handle('app:bootstrap', (): Bootstrap => ({
    profile: null,
    settings: getSettings(),
    rituals: [],
    clients: [],
    streak: { currentDays: 0, bestDays: 0, unlocked: [], equipped: [] },
    mood: {
      mood: 70,
      phrase: 'Tô animado, semana tá rendendo!',
      components: { adherence: 0.6, focusCompletion: 0.7, distraction: 0.1, overworkPenalty: 0, today: 70, weekAvg: 68 },
    },
    focus: null,
    integrations: [],
    claude: { state: 'checking' },
    firstRun: false,
    platform: process.platform,
  }));
  handle('tasks:all', () => []);
  handle('stats:today', () => mockStats());
}
