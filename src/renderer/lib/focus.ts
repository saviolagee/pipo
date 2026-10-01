// "Focar na próxima": a mesma escolha de tarefa do main (pickNextTask), calculada aqui para mostrar o
// nome da tarefa nos botões antes do clique.
import { useMemo } from 'react';
import { pickNextTask } from '@shared/suggest';
import type { Task } from '@shared/types';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { api } from './api';

export function useNextTask(excludeId?: number | null): Task | null {
  const tasks = useData((s) => s.tasks);
  const peak = useData((s) => s.profile?.energyPeak ?? 'varies');
  return useMemo(() => pickNextTask(tasks.filter((t) => t.id !== excludeId), new Date(), peak), [tasks, peak, excludeId]);
}

/** Minutos do foco padrão do perfil (preset do onboarding). */
export function useFocusMinutes(): number {
  return useData((s) => s.profile?.focusPreset.focusMin ?? 25);
}

/** Começa o foco na tarefa dada (ou na próxima sugerida). Sem tarefa nenhuma, abre a captura. */
export async function focusNext(taskId?: number | null, minutes?: number): Promise<void> {
  const ui = useUi.getState();
  const id = taskId ?? (await api.invoke('tasks:nextSuggested'))?.id ?? null;
  if (!id) {
    ui.setTab('add', true);
    useUi.setState({ captureMode: true });
    return;
  }
  ui.setTab('home', true);
  await api.invoke('focus:start', { taskId: id, minutes });
}
