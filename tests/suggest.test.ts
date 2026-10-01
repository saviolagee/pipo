import { describe, expect, it } from 'vitest';
import { pickNextTask } from '../src/shared/suggest';
import type { Task } from '../src/shared/types';

const base = (p: Partial<Task>): Task => ({
  id: 1, title: 't', notes: '', dueAt: null, estimateMin: 30, priority: 2, clientId: null, status: 'todo', snoozeCount: 0,
  source: 'manual', isToday: false, position: 1, createdAt: '', updatedAt: '', completedAt: null, subtasks: [], ...p,
});
const NOW = new Date(2026, 9, 1, 9, 30);

describe('pickNextTask', () => {
  it('prefere tarefas de hoje', () => {
    const r = pickNextTask([base({ id: 1, priority: 3 }), base({ id: 2, isToday: true })], NOW, 'morning');
    expect(r?.id).toBe(2);
  });
  it('prazo vencendo ganha', () => {
    const due = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const r = pickNextTask([base({ id: 1, isToday: true, priority: 3 }), base({ id: 2, isToday: true, dueAt: due })], NOW, 'evening');
    expect(r?.id).toBe(2);
  });
  it('no pico de energia escolhe a difícil; fora dele, a curta', () => {
    const hard = base({ id: 1, isToday: true, priority: 3, estimateMin: 90 });
    const easy = base({ id: 2, isToday: true, priority: 2, estimateMin: 10 });
    expect(pickNextTask([hard, easy], NOW, 'morning')?.id).toBe(1);
    expect(pickNextTask([hard, easy], NOW, 'evening', true)?.id).toBe(2);
  });
  it('sem tarefas abertas retorna null', () => {
    expect(pickNextTask([base({ status: 'done' })], NOW, 'morning')).toBeNull();
  });
});
