import { describe, expect, it } from 'vitest';
import { decide, MIN_GAP_MS, pickNext, shouldSilence, type BudgetState } from '../src/main/interruptions/budget';

const base: BudgetState = { now: 10_000_000, budget: 3, spentToday: 0, lastShownAt: null, paused: false, inMeeting: false, silencedUntil: {} };

describe('orçamento de interrupções', () => {
  it('com orçamento 3, a 4ª interrupção vira só expressão', () => {
    let s = { ...base };
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = decide('distraction', s);
      results.push(d.action);
      if (d.action === 'show') s = { ...s, spentToday: s.spentToday + 1, lastShownAt: s.now };
      s = { ...s, now: s.now + MIN_GAP_MS + 1 };
    }
    expect(results).toEqual(['show', 'show', 'show', 'expression']);
  });

  it('respeita 20 min entre interrupções', () => {
    const d = decide('goal', { ...base, spentToday: 1, lastShownAt: base.now - 5 * 60_000 });
    expect(d).toEqual({ action: 'queue', reason: 'gap', retryAt: base.now - 5 * 60_000 + MIN_GAP_MS });
  });

  it('em reunião enfileira; pausado descarta', () => {
    expect(decide('deadline', { ...base, inMeeting: true }).action).toBe('queue');
    expect(decide('deadline', { ...base, paused: true }).action).toBe('drop');
  });

  it('tipo silenciado vira expressão', () => {
    expect(decide('context', { ...base, silencedUntil: { context: base.now + 1000 } })).toEqual({ action: 'expression', reason: 'silenced' });
    expect(decide('context', { ...base, silencedUntil: { context: base.now - 1000 } }).action).toBe('show');
  });

  it('3 recusas seguidas silenciam o tipo', () => {
    expect(shouldSilence(['declined', 'declined', 'declined'])).toBe(true);
    expect(shouldSilence(['declined', 'dropped', 'declined', 'declined'])).toBe(true);
    expect(shouldSilence(['declined', 'accepted', 'declined'])).toBe(false);
    expect(shouldSilence(['declined', 'declined'])).toBe(false);
  });

  it('prioridade: prazo > distração > meta > destravar > contexto > padrão', () => {
    const q = [
      { type: 'pattern' as const, createdAt: 1 },
      { type: 'goal' as const, createdAt: 2 },
      { type: 'deadline' as const, createdAt: 3 },
      { type: 'distraction' as const, createdAt: 4 },
    ];
    expect(pickNext(q)?.type).toBe('deadline');
    expect(pickNext(q.filter((x) => x.type !== 'deadline'))?.type).toBe('distraction');
  });
});
