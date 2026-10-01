import type { Priority, Subtask, Task, TaskFilter, TaskInput, TaskPatch } from '@shared/types';
import { db } from '../index';
import { dayRange } from '../../time';

interface TaskRow {
  id: number;
  title: string;
  notes: string;
  due_at: string | null;
  estimate_min: number | null;
  priority: number;
  client_id: number | null;
  status: Task['status'];
  snooze_count: number;
  source: Task['source'];
  is_today: number;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SubtaskRow {
  id: number;
  task_id: number;
  title: string;
  done: number;
  position: number;
}

const toSub = (r: SubtaskRow): Subtask => ({ id: r.id, taskId: r.task_id, title: r.title, done: !!r.done, position: r.position });

function hydrate(rows: TaskRow[]): Task[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const subs = db().all<SubtaskRow>(`SELECT * FROM subtasks WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY position, id`, ...ids);
  const byTask = new Map<number, Subtask[]>();
  for (const s of subs) {
    const list = byTask.get(s.task_id) ?? [];
    list.push(toSub(s));
    byTask.set(s.task_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.due_at,
    estimateMin: r.estimate_min,
    priority: (r.priority as Priority) ?? 2,
    clientId: r.client_id,
    status: r.status,
    snoozeCount: r.snooze_count,
    source: r.source,
    isToday: !!r.is_today,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    subtasks: byTask.get(r.id) ?? [],
  }));
}

export function getTask(id: number): Task | null {
  return hydrate(db().all<TaskRow>('SELECT * FROM tasks WHERE id = ?', id))[0] ?? null;
}

export function allTasks(): Task[] {
  const { start } = dayRange(new Date());
  return hydrate(db().all<TaskRow>("SELECT * FROM tasks WHERE status != 'done' OR completed_at >= ? ORDER BY is_today DESC, position, id", start));
}

export function listTasks(filter: TaskFilter, now = new Date()): Task[] {
  const { start, end } = dayRange(now);
  const nowIso = now.toISOString();
  const q: Record<TaskFilter, [string, unknown[]]> = {
    today: ["status != 'done' AND (is_today = 1 OR (due_at IS NOT NULL AND due_at < ?)) ORDER BY position, id", [end]],
    upcoming: ["status != 'done' AND is_today = 0 AND due_at >= ? ORDER BY due_at", [end]],
    someday: ["status != 'done' AND is_today = 0 AND due_at IS NULL ORDER BY priority DESC, position, id", []],
    overdue: ["status != 'done' AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at", [nowIso]],
    done_today: ["status = 'done' AND completed_at >= ? ORDER BY completed_at DESC", [start]],
    open: ["status != 'done' ORDER BY is_today DESC, position, id", []],
  };
  const [where, params] = q[filter];
  return hydrate(db().all<TaskRow>(`SELECT * FROM tasks WHERE ${where}`, ...(params as string[])));
}

export function createTask(input: TaskInput): Task {
  const now = new Date().toISOString();
  const pos = (db().get<{ m: number | null }>('SELECT MAX(position) AS m FROM tasks')?.m ?? 0) + 1;
  const { lastId } = db().run(
    `INSERT INTO tasks (title, notes, due_at, estimate_min, priority, client_id, status, snooze_count, source, is_today, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'todo', 0, ?, ?, ?, ?, ?)`,
    input.title.trim(),
    input.notes ?? '',
    input.dueAt ?? null,
    input.estimateMin ?? null,
    input.priority ?? 2,
    input.clientId ?? null,
    input.source ?? 'manual',
    input.isToday ?? isDueToday(input.dueAt ?? null),
    pos,
    now,
    now,
  );
  if (input.subtasks?.length) addSubtasks(lastId, input.subtasks);
  return getTask(lastId) as Task;
}

function isDueToday(due: string | null): boolean {
  if (!due) return false;
  const { end } = dayRange(new Date());
  return due < end;
}

const COLS: Record<keyof TaskPatch, string> = {
  title: 'title',
  notes: 'notes',
  dueAt: 'due_at',
  estimateMin: 'estimate_min',
  priority: 'priority',
  clientId: 'client_id',
  status: 'status',
  snoozeCount: 'snooze_count',
  source: 'source',
  isToday: 'is_today',
  position: 'position',
  completedAt: 'completed_at',
};

export function updateTask(id: number, patch: TaskPatch): Task {
  const keys = (Object.keys(patch) as Array<keyof TaskPatch>).filter((k) => COLS[k] && patch[k] !== undefined);
  if (keys.length) {
    const sets = keys.map((k) => `${COLS[k]} = ?`).join(', ');
    const vals = keys.map((k) => patch[k] as string | number | boolean | null);
    db().run(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`, ...vals, new Date().toISOString(), id);
  }
  const t = getTask(id);
  if (!t) throw new Error(`Tarefa ${id} não encontrada`);
  return t;
}

export function completeTask(id: number, done: boolean): Task {
  return updateTask(id, { status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null });
}

export function deleteTask(id: number): void {
  db().run('DELETE FROM tasks WHERE id = ?', id);
}

export function reorderTasks(ids: number[]): void {
  db().tx(() => ids.forEach((id, i) => db().run('UPDATE tasks SET position = ? WHERE id = ?', i + 1, id)));
}

/** Adia para amanhã e conta o adiamento (usado em padrões e humor). */
export function snoozeTask(id: number): Task {
  const t = getTask(id);
  if (!t) throw new Error(`Tarefa ${id} não encontrada`);
  const base = new Date();
  base.setDate(base.getDate() + 1);
  if (t.dueAt) {
    const d = new Date(t.dueAt);
    base.setHours(d.getHours(), d.getMinutes(), 0, 0);
  } else base.setHours(0, 0, 0, 0);
  return updateTask(id, { dueAt: base.toISOString(), isToday: false, snoozeCount: t.snoozeCount + 1 });
}

export function addSubtasks(taskId: number, titles: string[]): Task {
  const pos = db().get<{ m: number | null }>('SELECT MAX(position) AS m FROM subtasks WHERE task_id = ?', taskId)?.m ?? 0;
  db().tx(() => titles.filter((x) => x.trim()).forEach((title, i) => db().run('INSERT INTO subtasks (task_id, title, done, position) VALUES (?, ?, 0, ?)', taskId, title.trim(), pos + i + 1)));
  return getTask(taskId) as Task;
}

export function toggleSubtask(subtaskId: number, done: boolean): Task {
  db().run('UPDATE subtasks SET done = ? WHERE id = ?', done, subtaskId);
  const r = db().get<{ task_id: number }>('SELECT task_id FROM subtasks WHERE id = ?', subtaskId);
  if (!r) throw new Error('Subtarefa não encontrada');
  return getTask(r.task_id) as Task;
}

export function deleteSubtask(subtaskId: number): Task {
  const r = db().get<{ task_id: number }>('SELECT task_id FROM subtasks WHERE id = ?', subtaskId);
  db().run('DELETE FROM subtasks WHERE id = ?', subtaskId);
  return getTask(r?.task_id ?? -1) as Task;
}
