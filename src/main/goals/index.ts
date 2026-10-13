// Trilha de objetivos: IPC, aviso de mudança e a virada do dia (empurra o que ficou para trás).
import type { Goal } from '@shared/trail';
import { emit } from '../bus';
import { addAction, createGoal, deleteAction, deleteGoal, listGoals, reflowAll, renameStage, reorderActions, setActionDone, updateAction, updateGoal } from '../db/repos/goals';
import { refreshStreak } from '../insights/streak';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { every } from '../scheduler';
import { goalTools } from './tools';

/** Avisa o renderer que os planos mudaram (inclusive por ações do agente). */
export function goalsChanged(): Goal[] {
  const goals = listGoals();
  emit('goals:changed', goals);
  return goals;
}

export function registerGoals(): void {
  const mut =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      const r = fn(...a);
      goalsChanged();
      return r;
    };

  handle('goals:list', () => {
    // Quem abre a trilha já vê os dias acertados, mesmo que o app tenha ficado ligado de um dia para o outro.
    reflowAll();
    return listGoals();
  });
  handle('goals:create', mut((input) => createGoal(input)));
  handle('goals:update', mut((id, patch) => updateGoal(id, patch)));
  handle('goals:delete', mut((id) => deleteGoal(id)));
  handle('goals:addAction', mut((goalId, input) => addAction(goalId, input)));
  handle('goals:updateAction', mut((id, patch) => updateAction(id, patch)));
  handle('goals:deleteAction', mut((id) => deleteAction(id)));
  handle(
    'goals:setDone',
    mut((id, done) => {
      const g = setActionDone(id, done);
      // A ação do dia feita conta para a sequência de dias.
      if (done) void refreshStreak();
      return g;
    }),
  );
  handle('goals:reorder', mut((goalId, ids) => reorderActions(goalId, ids)));
  handle('goals:renameStage', mut((goalId, from, to) => renameStage(goalId, from, to)));

  registerTools(goalTools(goalsChanged));
  every('goals:reflow', 5 * 60_000, () => {
    if (reflowAll()) goalsChanged();
  });
}
