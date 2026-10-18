import type { Bootstrap, DayStats } from '@shared/types';
import { claudeStatus, checkClaude } from './agent/detect-claude';
import { emit } from './bus';
import { listClients, saveClients } from './db/repos/clients';
import { getProfile, resetOnboarding, saveProfile } from './db/repos/profile';
import { getSettings } from './db/repos/settings';
import { handle } from './ipc';
import { todayStats } from './stats';
import { setAutostart } from './system';
import { workspaceDir } from './paths';

/** Provedores dos módulos das fases seguintes (registrados no boot). */
export const providers: {
  stats: () => DayStats;
  extra: () => Partial<Bootstrap>;
} = {
  stats: () => todayStats(),
  extra: () => ({}),
};

export function buildBootstrap(): Bootstrap {
  const profile = getProfile();
  return {
    profile,
    settings: getSettings(),
    clients: listClients(),
    streak: { currentDays: 0, bestDays: 0, unlocked: [], equipped: [] },
    mood: {
      mood: 60,
      phrase: profile?.name ? `Oi, ${profile.name}! Bora?` : 'Oi! Bora?',
      components: { adherence: 0.5, activity: 0.5, distraction: 0, overworkPenalty: 0, today: 60, weekAvg: 60 },
    },
    integrations: [],
    claude: claudeStatus(),
    firstRun: !profile || !profile.onboardedAt,
    platform: process.platform,
    ...providers.extra(),
  };
}

export function registerBootstrapIpc(): void {
  handle('app:bootstrap', () => buildBootstrap());
  handle('stats:today', () => providers.stats());
  handle('profile:get', () => getProfile());
  handle('profile:save', (p) => {
    const saved = saveProfile(p);
    setAutostart(saved.autostart);
    emit('stats:changed', providers.stats());
    return saved;
  });
  handle('profile:resetOnboarding', () => resetOnboarding());
  handle('clients:list', () => listClients());
  handle('clients:save', (items) => saveClients(items));
  handle('claude:status', (recheck) => (recheck ? checkClaude(workspaceDir(), true) : claudeStatus()));
}
