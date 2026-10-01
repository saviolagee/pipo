import { parseCapture } from '@shared/parse-capture';
import { pickNextTask } from '@shared/suggest';
import type { Task } from '@shared/types';
import { bus, emit } from '../bus';
import { listClients } from '../db/repos/clients';
import { getProfile } from '../db/repos/profile';
import {
  addSubtasks,
  allTasks,
  completeTask,
  createTask,
  deleteSubtask,
  deleteTask,
  listTasks,
  reorderTasks,
  snoozeTask,
  toggleSubtask,
  updateTask,
} from '../db/repos/tasks';
import { focusState, pauseFocus, resumeFocus, ritualDone, skipPhase, startFocus, stopFocus } from '../focus/session';
import { handle } from '../ipc';
import { todayStats } from '../stats';

/** Avisa o renderer que tarefas/estatísticas mudaram (inclusive por ações do agente). */
export function tasksChanged(): void {
  emit('tasks:changed', null);
  emit('stats:changed', todayStats());
  bus.emit('task:changed', null);
}

export function nextSuggested(preferShort = false): Task | null {
  return pickNextTask(listTasks('open'), new Date(), getProfile()?.energyPeak ?? 'varies', preferShort);
}

export function registerTasksIpc(): void {
  const mut =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      const r = fn(...a);
      tasksChanged();
      return r;
    };

  handle('tasks:list', (f) => listTasks(f));
  handle('tasks:all', () => allTasks());
  handle('tasks:create', mut((input) => createTask(input)));
  handle('tasks:update', mut((id, patch) => updateTask(id, patch)));
  handle(
    'tasks:complete',
    mut((id, done) => {
      const t = completeTask(id, done);
      if (done) bus.emit('task:completed', { taskId: id });
      return t;
    }),
  );
  handle('tasks:delete', mut((id) => deleteTask(id)));
  handle('tasks:reorder', mut((ids) => reorderTasks(ids)));
  handle('tasks:snooze', mut((id) => snoozeTask(id)));
  handle('tasks:nextSuggested', () => nextSuggested());
  handle('tasks:parse', (text) => parseCapture(text, listClients()));
  handle('subtasks:add', mut((taskId, titles) => addSubtasks(taskId, titles)));
  handle('subtasks:toggle', mut((id, done) => toggleSubtask(id, done)));
  handle('subtasks:delete', mut((id) => deleteSubtask(id)));

  handle('focus:start', async (opts) => {
    const s = await startFocus(opts);
    tasksChanged();
    return s;
  });
  handle('focus:ritualDone', (skipToday) => ritualDone(!!skipToday));
  handle('focus:pause', () => pauseFocus());
  handle('focus:resume', () => resumeFocus());
  handle('focus:skipPhase', () => skipPhase());
  handle('focus:stop', async (completed) => {
    await stopFocus(completed);
    tasksChanged();
  });
  handle('focus:get', () => focusState());
  bus.on('focus:completed', () => tasksChanged());
}
