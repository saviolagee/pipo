// Estado ao vivo de cada Pipo (aceso, esperando você, erro…) para a pill e a aba Equipe.
import type { PipoLive, PipoLiveState } from '@shared/pipos';
import { emit } from '../bus';

const live = new Map<number, PipoLive>();
const doneTimers = new Map<number, NodeJS.Timeout>();

export function getLive(pipoId: number): PipoLive {
  return live.get(pipoId) ?? { pipoId, state: 'idle', runId: null, stepLabel: null };
}

export function allLive(): PipoLive[] {
  return [...live.values()];
}

export function setLive(pipoId: number, state: PipoLiveState, runId: number | null = null, stepLabel: string | null = null): void {
  const t = doneTimers.get(pipoId);
  if (t) clearTimeout(t);
  const next: PipoLive = { pipoId, state, runId, stepLabel };
  live.set(pipoId, next);
  emit('pipos:live', next);
  // "Concluiu": pulinho e brilho por um instante, depois apaga.
  if (state === 'done') {
    doneTimers.set(
      pipoId,
      setTimeout(() => setLive(pipoId, 'idle'), 2500),
    );
  }
}

export function clearLive(pipoId: number): void {
  live.delete(pipoId);
}
