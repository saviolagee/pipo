import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined } }));
const { blendMood, dayMood, moodPhrase } = await import('../src/main/insights/mood');
const { currentStreak, qualifies, unlocksFor } = await import('../src/main/insights/streak');
const { analyzePatterns, bestFocusHour, mostSnoozed } = await import('../src/main/insights/patterns');

describe('humor', () => {
  const base = { plannedTasks: 4, doneTasks: 0, focusCompleted: 0, focusAbandoned: 0, focusMin: 0, distractedMin: 0, workedMin: 0, goalMin: 360 };
  it('dia bom deixa o Pipo animado; dia ruim, pra baixo', () => {
    const good = dayMood({ ...base, doneTasks: 4, focusCompleted: 3, focusMin: 200, distractedMin: 5, workedMin: 340 });
    const bad = dayMood({ ...base, doneTasks: 0, focusCompleted: 0, focusAbandoned: 3, focusMin: 30, distractedMin: 90, workedMin: 60 });
    expect(good.score).toBeGreaterThanOrEqual(80);
    expect(bad.score).toBeLessThan(30);
  });
  it('trabalhar muito acima da meta também baixa o humor', () => {
    const atGoal = dayMood({ ...base, doneTasks: 4, focusCompleted: 3, focusMin: 200, workedMin: 360 });
    const way = dayMood({ ...base, doneTasks: 4, focusCompleted: 3, focusMin: 200, workedMin: 600 });
    expect(way.overworkPenalty).toBeGreaterThan(0);
    expect(way.score).toBeLessThan(atGoal.score);
  });
  it('média 60/40 com os últimos 7 dias', () => {
    expect(blendMood(100, [50, 50])).toBe(80);
    expect(blendMood(70, [])).toBe(70);
  });
  it('frase por faixa e tom', () => {
    expect(moodPhrase(90, 'cute', 0)).toBe('Tô animado, semana tá rendendo!');
    expect(moodPhrase(25, 'cute', 0)).toBe('Hoje tá difícil né? Bora só uma tarefinha.');
    expect(moodPhrase(10, 'direct', 0)).toContain('2 minutos');
  });
});

describe('sequência', () => {
  it('conta só dias úteis que bateram a meta; hoje em aberto não quebra', () => {
    const days = [
      { date: 'd0', workday: true, qualifies: false },
      { date: 'd1', workday: true, qualifies: true },
      { date: 'd2', workday: false, qualifies: false },
      { date: 'd3', workday: true, qualifies: true },
      { date: 'd4', workday: true, qualifies: true },
      { date: 'd5', workday: true, qualifies: false },
      { date: 'd6', workday: true, qualifies: true },
    ];
    expect(currentStreak(days, 'd0')).toBe(3);
    expect(currentStreak(days, 'x')).toBe(0);
  });
  it('regra: 80% da meta e 1 foco completo', () => {
    expect(qualifies(290, 360, 1)).toBe(true);
    expect(qualifies(280, 360, 1)).toBe(false);
    expect(qualifies(360, 360, 0)).toBe(false);
  });
  it('desbloqueios 3/7/14/30/60', () => {
    expect(unlocksFor(2)).toEqual([]);
    expect(unlocksFor(7)).toEqual(['scarf', 'cool_glasses']);
    expect(unlocksFor(60)).toHaveLength(5);
  });
});

describe('padrões', () => {
  const sessions = Array.from({ length: 8 }, (_, i) => ({ startedAt: new Date(2026, 8, 1 + i, i % 4 === 0 ? 15 : 9, 5).toISOString(), completed: true, focusedSec: 3000 }));
  it('acha o tema mais adiado e o melhor horário', () => {
    const tasks = [
      { title: 'Conciliar financeiro de agosto', client: null, snoozeCount: 3 },
      { title: 'Relatório financeiro mensal', client: null, snoozeCount: 2 },
      { title: 'Ligar pro contador', client: null, snoozeCount: 0 },
    ];
    expect(mostSnoozed(tasks)?.group).toBe('financeiro');
    expect(bestFocusHour(sessions)).toBe(9);
    const s = analyzePatterns({ tasks, sessions, days: [] });
    expect(s[0].text).toBe('Você adia as tarefas de financeiro toda semana. Bloqueio terça 9h–10h pra isso?');
    expect(s[0].block).toEqual({ weekday: 2, hour: 9, durationMin: 60, title: 'Foco: financeiro' });
  });
  it('sem adiamentos recorrentes, não sugere bloco', () => {
    const s = analyzePatterns({ tasks: [{ title: 'Uma tarefa qualquer', client: null, snoozeCount: 1 }], sessions: [], days: [] });
    expect(s.find((x) => x.block)).toBeUndefined();
  });
});
