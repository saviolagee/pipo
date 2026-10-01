import { emit } from '../bus';
import { blocksBetween, deleteBlocks, setBlockClient } from '../db/repos/activity';
import { handle } from '../ipc';
import { statsHooks, todayStats } from '../stats';
import { exportCsv } from './export-csv';
import { dayReview, workTime } from './review';
import { app } from 'electron';
import { currentActivity, setFakeActivitySource, startTracker } from './tracker';

export function registerActivity(): void {
  statsHooks.workedMin = (start, end) => workTime(start, end);
  const prev = statsHooks.meetings;
  // Minutos de reunião pelo registro (a agenda, quando conectada, tem prioridade — Fase 10).
  statsHooks.meetings = (start, end) => prev?.(start, end) ?? { meetingMin: workTime(start, end).meetingMin, next: null };

  handle('activity:current', () => currentActivity());
  handle('activity:blocks', (from, to) => blocksBetween(from, to));
  handle('activity:classify', (assignments) => {
    for (const a of assignments) setBlockClient(a.blockId, a.clientId);
    emit('stats:changed', todayStats());
  });
  handle('activity:exportCsv', (from, to) => exportCsv(from, to));
  handle('activity:deleteRange', (from, to) => {
    const n = deleteBlocks(from, to);
    emit('stats:changed', todayStats());
    return n;
  });
  handle('stats:dayReview', (date) => dayReview(date ? new Date(date) : new Date()));
  // Desenvolvimento: PIPO_FAKE_ACTIVITY=1 alterna apps simulados a cada 10s (validação sem janelas reais).
  if (!app.isPackaged && process.env.PIPO_FAKE_ACTIVITY) {
    const fake = [
      { app: 'Code', title: 'proposta-prosaude.md — docs', url: null },
      { app: 'Google Chrome', title: 'Lofi beats - YouTube', url: null },
      { app: 'Slack', title: 'geral - Empresa', url: null },
      { app: 'Excel', title: 'Orçamento Pró-Saúde.xlsx', url: null },
    ];
    setFakeActivitySource(() => fake[Math.floor(Date.now() / 10_000) % fake.length]);
  }
  startTracker();
}
