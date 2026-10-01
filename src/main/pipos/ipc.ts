// IPC dos Pipos coloridos (Fase 16+).
import type { PipoSummary } from '@shared/pipos';
import { emit } from '../bus';
import { handle } from '../ipc';
import { clearLive, getLive } from './live';
import {
  closeOrphanRuns,
  createPipo,
  deletePipo,
  getPipo,
  lastRun,
  listMemory,
  listPipos,
  listRuns,
  listTriggers,
  listVersions,
  updatePipo,
  addVersion,
  getRun,
  runSteps,
  deleteOldRuns,
} from './repo';
import { deletePipoSecrets, secretNames, setPipoSecret } from './secrets';
import { startRun } from './deps';
import { cancelRun } from './runner';

/** Preenchido pelos gatilhos (Fase 19): próxima execução agendada. */
export const pipoHooks: { nextRunAt: (pipoId: number) => string | null } = { nextRunAt: () => null };

export function summaries(): PipoSummary[] {
  return listPipos().map((p) => ({ ...p, live: getLive(p.id), lastRun: lastRun(p.id), nextRunAt: pipoHooks.nextRunAt(p.id), secrets: secretNames(p.slug) }));
}

export function pipesChanged(): void {
  emit('pipos:changed', summaries());
}

export function registerPiposIpc(): void {
  const orphans = closeOrphanRuns();
  if (orphans) console.warn(`[pipos] ${orphans} execução(ões) interrompida(s) pelo fechamento do app.`);

  handle('pipos:list', () => summaries());
  handle('pipos:get', (id) => {
    const pipo = getPipo(id);
    if (!pipo) return null;
    return { pipo, versions: listVersions(id), triggers: listTriggers(id), runs: listRuns(id, 30), memory: listMemory(id), secrets: secretNames(pipo.slug) };
  });
  handle('pipos:create', (p) => {
    const created = createPipo(p);
    pipesChanged();
    return created;
  });
  handle('pipos:update', (id, patch) => {
    const r = updatePipo(id, patch);
    pipesChanged();
    return r;
  });
  handle('pipos:delete', (id) => {
    const p = getPipo(id);
    if (!p) return;
    deletePipoSecrets(p.slug);
    deletePipo(id);
    clearLive(id);
    pipesChanged();
  });
  handle('pipos:run', async (id, opts) => ({ runId: await startRun(id, { dryRun: opts?.dryRun, trigger: opts?.trigger ?? 'manual', input: opts?.input }) }));
  handle('pipos:cancel', (runId) => cancelRun(runId));
  handle('pipos:runDetail', (runId) => {
    const run = getRun(runId);
    return run ? { run, steps: runSteps(runId) } : null;
  });
  handle('pipos:runs', (id) => listRuns(id, 50));
  handle('pipos:saveVersion', (id, playbook, changelog) => {
    const v = addVersion(id, playbook, changelog);
    pipesChanged();
    return v;
  });
  // Execuções antigas (mais de 90 dias) saem do histórico.
  deleteOldRuns(90);

  handle('pipos:setSecret', (id, name, value) => {
    const p = getPipo(id);
    if (!p) throw new Error('Pipo não encontrado.');
    setPipoSecret(p.slug, name, value);
    pipesChanged();
    return secretNames(p.slug);
  });
}
