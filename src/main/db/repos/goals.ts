// Trilha de objetivos: planos e ações por dia. Toda mudança passa por `settle`, que recalcula os dias.
import {
  addDaysKey,
  consecutiveDays,
  isDayKey,
  nextFreeDay,
  ordered,
  pullEarlier,
  reflow,
  reorderPending,
  workOn,
  type ActionInput,
  type ActionPatch,
  type CanWork,
  type Goal,
  type GoalAction,
  type GoalInput,
  type GoalPatch,
  type GoalStatus,
  type StageInput,
} from '@shared/trail';
import { dayKey } from '../../time';
import { db } from '../index';
import { isAbsent } from './days';
import { getProfile } from './profile';

interface GoalRow {
  id: number;
  title: string;
  outcome: string;
  target_date: string | null;
  weekdays_json: string;
  status: GoalStatus;
  created_at: string;
  finished_at: string | null;
}

interface ActionRow {
  id: number;
  goal_id: number;
  stage: string;
  title: string;
  notes: string;
  position: number;
  day: string;
  planned_day: string;
  done_at: string | null;
}

const toAction = (r: ActionRow): GoalAction => ({ id: r.id, goalId: r.goal_id, stage: r.stage, title: r.title, notes: r.notes, position: r.position, day: r.day, plannedDay: r.planned_day, doneAt: r.done_at });

function weekdaysOf(json: string): number[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(Number).filter((n) => n >= 0 && n <= 6) : [];
  } catch {
    return [];
  }
}

function hydrate(r: GoalRow): Goal {
  const actions = db().all<ActionRow>('SELECT * FROM goal_actions WHERE goal_id = ? ORDER BY position, id', r.id).map(toAction);
  return { id: r.id, title: r.title, outcome: r.outcome, targetDate: r.target_date, weekdays: weekdaysOf(r.weekdays_json), status: r.status, createdAt: r.created_at, finishedAt: r.finished_at, actions };
}

const today = (): string => dayKey(new Date());

function canWork(weekdays: number[]): CanWork {
  return workOn(weekdays, isAbsent);
}

/** Dias em que o usuário trabalha (perfil); sem perfil, de segunda a sexta. */
function defaultWeekdays(): number[] {
  const p = getProfile();
  return p?.workDays.length ? [...p.workDays] : [1, 2, 3, 4, 5];
}

/** Dia em que `count` ações seguidas terminam (para mostrar antes de criar o plano). */
export function planEnd(count: number, weekdays?: number[], from = today()): string | null {
  const days = consecutiveDays(count, from, canWork(weekdays?.length ? weekdays : defaultWeekdays()));
  return days[days.length - 1] ?? null;
}

export function getGoal(id: number): Goal | null {
  const r = db().get<GoalRow>('SELECT * FROM goals WHERE id = ?', id);
  return r ? hydrate(r) : null;
}

/** Ativos primeiro (os mais antigos na frente), depois os concluídos. Arquivados só com `all`. */
export function listGoals(all = false): Goal[] {
  const rows = db().all<GoalRow>(`SELECT * FROM goals ${all ? '' : "WHERE status != 'archived'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, id`);
  return rows.map(hydrate);
}

function requireGoal(id: number): Goal {
  const g = getGoal(id);
  if (!g) throw new Error(`Plano ${id} não encontrado.`);
  return g;
}

function requireAction(id: number): GoalAction {
  const r = db().get<ActionRow>('SELECT * FROM goal_actions WHERE id = ?', id);
  if (!r) throw new Error(`Ação ${id} não encontrada.`);
  return toAction(r);
}

/** Recalcula os dias das pendentes e o estado do plano (concluído quando não sobra ação). */
function settle(goalId: number, now = today()): Goal {
  const g = requireGoal(goalId);
  for (const c of reflow(g.actions, now, canWork(g.weekdays))) db().run('UPDATE goal_actions SET day = ? WHERE id = ?', c.day, c.id);
  const allDone = g.actions.length > 0 && g.actions.every((a) => a.doneAt);
  if (allDone && g.status === 'active') db().run("UPDATE goals SET status = 'done', finished_at = ? WHERE id = ?", new Date().toISOString(), goalId);
  else if (!allDone && g.status === 'done') db().run("UPDATE goals SET status = 'active', finished_at = NULL WHERE id = ?", goalId);
  return requireGoal(goalId);
}

function insertStages(goalId: number, stages: StageInput[], from: string, weekdays: number[], firstPosition: number): void {
  const flat = stages.flatMap((s) =>
    s.actions
      .map((a) => (typeof a === 'string' ? { title: a.trim(), notes: '', day: undefined as string | undefined } : { title: String(a.title ?? '').trim(), notes: String(a.notes ?? '').trim(), day: isDayKey(a.day) ? a.day : undefined }))
      .filter((a) => a.title)
      .map((a) => ({ ...a, stage: String(s.title ?? '').trim() })),
  );
  const days = consecutiveDays(flat.length, from, canWork(weekdays));
  flat.forEach((a, i) => {
    // Dia informado vale se não ficar antes do início; a ordem e as folgas são acertadas no `settle`.
    const day = a.day && a.day >= from ? a.day : days[i];
    db().run('INSERT INTO goal_actions (goal_id, stage, title, notes, position, day, planned_day) VALUES (?, ?, ?, ?, ?, ?, ?)', goalId, a.stage, a.title, a.notes, firstPosition + i, day, day);
  });
}

/** O dia original passa a ser o dia já acertado: plano novo não nasce "escorregado". */
function freezePlan(goalId: number, onlyPending = false): void {
  db().run(`UPDATE goal_actions SET planned_day = day WHERE goal_id = ? ${onlyPending ? 'AND done_at IS NULL' : ''}`, goalId);
}

export function createGoal(input: GoalInput, now = today()): Goal {
  const title = input.title.trim();
  if (!title) throw new Error('O plano precisa de um nome.');
  const weekdays = input.weekdays?.length ? input.weekdays : defaultWeekdays();
  return db().tx(() => {
    const { lastId } = db().run(
      'INSERT INTO goals (title, outcome, target_date, weekdays_json, created_at) VALUES (?, ?, ?, ?, ?)',
      title,
      (input.outcome ?? '').trim(),
      isDayKey(input.targetDate) ? input.targetDate : null,
      JSON.stringify(weekdays),
      new Date().toISOString(),
    );
    insertStages(lastId, input.stages ?? [], now, weekdays, 1);
    settle(lastId, now);
    freezePlan(lastId);
    return requireGoal(lastId);
  });
}

export function updateGoal(id: number, patch: GoalPatch, now = today()): Goal {
  const g = requireGoal(id);
  const next = {
    title: patch.title?.trim() || g.title,
    outcome: patch.outcome !== undefined ? patch.outcome.trim() : g.outcome,
    targetDate: patch.targetDate !== undefined ? (isDayKey(patch.targetDate) ? patch.targetDate : null) : g.targetDate,
    weekdays: patch.weekdays?.length ? patch.weekdays.filter((n) => n >= 0 && n <= 6) : g.weekdays,
    status: patch.status ?? g.status,
  };
  db().run(
    'UPDATE goals SET title = ?, outcome = ?, target_date = ?, weekdays_json = ?, status = ?, finished_at = ? WHERE id = ?',
    next.title,
    next.outcome,
    next.targetDate,
    JSON.stringify(next.weekdays),
    next.status,
    next.status === 'active' ? null : (g.finishedAt ?? new Date().toISOString()),
    id,
  );
  // Arquivado fica como está; ativo ou concluído recalcula os dias (mudou os dias da semana, por exemplo).
  return next.status === 'archived' ? requireGoal(id) : settle(id, now);
}

export function deleteGoal(id: number): void {
  db().run('DELETE FROM goals WHERE id = ?', id);
}

export function addAction(goalId: number, input: ActionInput, now = today()): Goal {
  const g = requireGoal(goalId);
  const title = input.title.trim();
  if (!title) throw new Error('A ação precisa de um texto.');
  const list = ordered(g.actions);
  // afterId 0 = no começo da trilha; sem afterId = no fim.
  const after = input.afterId === 0 ? undefined : input.afterId ? list.find((a) => a.id === input.afterId) : list[list.length - 1];
  const position = after ? after.position + 1 : (list[0]?.position ?? 1);
  // Entra no dia seguinte ao da ação anterior; as de depois são empurradas no `settle`.
  const day = after && !after.doneAt ? addDaysKey(after.day, 1) : now;
  return db().tx(() => {
    db().run('UPDATE goal_actions SET position = position + 1 WHERE goal_id = ? AND position >= ?', goalId, position);
    db().run(
      'INSERT INTO goal_actions (goal_id, stage, title, notes, position, day, planned_day) VALUES (?, ?, ?, ?, ?, ?, ?)',
      goalId,
      input.stage !== undefined ? input.stage.trim() : (after?.stage ?? ''),
      title,
      (input.notes ?? '').trim(),
      position,
      day,
      day,
    );
    return settle(goalId, now);
  });
}

export function updateAction(id: number, patch: ActionPatch, now = today()): Goal {
  const a = requireAction(id);
  const g = requireGoal(a.goalId);
  let day = a.day;
  if (patch.day !== undefined && !a.doneAt) {
    if (!isDayKey(patch.day)) throw new Error('Dia inválido. Use AAAA-MM-DD.');
    // Mover de dia não muda a ordem: nunca antes de hoje nem antes da ação pendente anterior.
    const before = ordered(g.actions).filter((x) => !x.doneAt && x.position < a.position);
    const floor = before.length ? addDaysKey(before[before.length - 1].day, 1) : now;
    day = nextFreeDay(patch.day < floor ? floor : patch.day, canWork(g.weekdays));
  }
  db().run('UPDATE goal_actions SET title = ?, notes = ?, stage = ?, day = ? WHERE id = ?', patch.title?.trim() || a.title, patch.notes !== undefined ? patch.notes.trim() : a.notes, patch.stage !== undefined ? patch.stage.trim() : a.stage, day, id);
  return settle(a.goalId, now);
}

export function deleteAction(id: number, now = today()): Goal {
  const a = requireAction(id);
  db().run('DELETE FROM goal_actions WHERE id = ?', id);
  return settle(a.goalId, now);
}

export function setActionDone(id: number, done: boolean, now = today()): Goal {
  const a = requireAction(id);
  if (done && !a.doneAt) {
    db().run('UPDATE goal_actions SET done_at = ? WHERE id = ?', new Date().toISOString(), id);
    // Feita antes do dia: o resto da trilha chega mais cedo.
    const g = requireGoal(a.goalId);
    for (const c of pullEarlier(g.actions, a, now, canWork(g.weekdays))) db().run('UPDATE goal_actions SET day = ? WHERE id = ?', c.day, c.id);
  }
  // Desfeita, volta para hoje (e não para o dia antigo, que empurraria o plano inteiro).
  else if (!done) db().run('UPDATE goal_actions SET done_at = NULL, day = ? WHERE id = ?', now, id);
  return settle(a.goalId, now);
}

/** Nova ordem das pendentes (ids). Os dias e as etapas ficam onde estão; as ações trocam de lugar. */
export function reorderActions(goalId: number, ids: number[], now = today()): Goal {
  const g = requireGoal(goalId);
  return db().tx(() => {
    for (const r of reorderPending(g.actions, ids)) db().run('UPDATE goal_actions SET position = ?, day = ?, stage = ? WHERE id = ?', r.position, r.day, r.stage, r.id);
    return settle(goalId, now);
  });
}

/** Troca o que falta fazer por um novo desmembramento (o que já foi feito fica). */
export function replacePending(goalId: number, stages: StageInput[], now = today()): Goal {
  const g = requireGoal(goalId);
  return db().tx(() => {
    db().run('DELETE FROM goal_actions WHERE goal_id = ? AND done_at IS NULL', goalId);
    const done = g.actions.filter((a) => a.doneAt);
    insertStages(goalId, stages, now, g.weekdays, done.reduce((m, a) => Math.max(m, a.position), 0) + 1);
    settle(goalId, now);
    freezePlan(goalId, true);
    return requireGoal(goalId);
  });
}

export function renameStage(goalId: number, from: string, to: string): Goal {
  db().run('UPDATE goal_actions SET stage = ? WHERE goal_id = ? AND stage = ?', to.trim(), goalId, from);
  return requireGoal(goalId);
}

/** Virada do dia: empurra o que ficou para trás em todos os planos ativos. Devolve se algo mudou. */
export function reflowAll(now = today()): boolean {
  let changed = false;
  for (const r of db().all<{ id: number }>("SELECT id FROM goals WHERE status = 'active'")) {
    const g = requireGoal(r.id);
    if (reflow(g.actions, now, canWork(g.weekdays)).length) {
      settle(r.id, now);
      changed = true;
    }
  }
  return changed;
}

/** Ações da trilha concluídas num dia (para a sequência de dias). */
export function actionsDoneOn(start: string, end: string): number {
  return db().get<{ n: number }>('SELECT COUNT(*) AS n FROM goal_actions WHERE done_at >= ? AND done_at < ?', start, end)?.n ?? 0;
}
