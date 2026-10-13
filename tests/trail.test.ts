import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { consecutiveDays, fmtDay, reflow, reorderPending, stagesOf, summarize, workOn, type Goal, type GoalAction } from '../src/shared/trail';

const dir = mkdtempSync(join(tmpdir(), 'pipo-trilha-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  dialog: {},
  shell: {},
  protocol: {},
  powerMonitor: {},
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/db/repos/goals');
const { setDay } = await import('../src/main/db/repos/days');
openDb(join(dir, 'pipo.db'));

// Setembro de 2026, sem feriados depois do dia 7: segunda 14, sexta 18, segunda 21.
const MON = '2026-09-14';
const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const FRI = '2026-09-18';
const SAT = '2026-09-19';
const MON2 = '2026-09-21';
const TUE2 = '2026-09-22';
const weekdays = workOn([1, 2, 3, 4, 5]);

let seq = 0;
function action(day: string, o: Partial<GoalAction> = {}): GoalAction {
  seq++;
  return { id: seq, goalId: 1, stage: '', title: `Ação ${seq}`, notes: '', position: seq, day, plannedDay: day, doneAt: null, ...o };
}
const daysOf = (g: Goal): string[] => g.actions.map((a) => a.day);
const plan = (...titles: string[]): { title: string; stages: Array<{ title: string; actions: string[] }> } => ({ title: 'Lançar o site', stages: [{ title: 'Etapa 1', actions: titles }] });

describe('datas da trilha', () => {
  it('em dia, nada muda', () => {
    expect(reflow([action(MON), action(TUE), action(WED)], MON, weekdays)).toEqual([]);
  });

  it('ação atrasada vem para hoje e as seguintes escorregam junto', () => {
    const [a, b, c] = [action(MON), action(TUE), action(WED)];
    expect(reflow([a, b, c], WED, weekdays)).toEqual([
      { id: a.id, day: WED },
      { id: b.id, day: THU },
      { id: c.id, day: FRI },
    ]);
  });

  it('fim de semana não conta como atraso de três dias', () => {
    const [a, b] = [action(FRI), action(MON2)];
    // Sábado: a de sexta vai para segunda e a de segunda anda um dia livre, para terça.
    expect(reflow([a, b], SAT, weekdays)).toEqual([
      { id: a.id, day: MON2 },
      { id: b.id, day: TUE2 },
    ]);
  });

  it('mantém o espaço que havia entre as ações', () => {
    const [a, b] = [action(MON), action(MON2)];
    expect(reflow([a, b], TUE, weekdays)).toEqual([
      { id: a.id, day: TUE },
      { id: b.id, day: TUE2 },
    ]);
  });

  it('concluídas ficam onde estão; só as pendentes andam', () => {
    const done = action(MON, { doneAt: '2026-09-14T15:00:00.000Z' });
    const next = action(TUE);
    expect(reflow([done, next], THU, weekdays)).toEqual([{ id: next.id, day: THU }]);
  });

  it('folga marcada pula o dia', () => {
    const off = workOn([1, 2, 3, 4, 5], (d) => d === TUE);
    expect(consecutiveDays(3, MON, off)).toEqual([MON, WED, THU]);
    expect(consecutiveDays(2, SAT, weekdays)).toEqual([MON2, TUE2]);
  });

  it('reordenar troca as ações de vaga: dia e etapa ficam no lugar', () => {
    const done = action(MON, { doneAt: '2026-09-14T15:00:00.000Z', stage: 'A' });
    const [x, y, z] = [action(TUE, { stage: 'A' }), action(WED, { stage: 'B' }), action(THU, { stage: 'B' })];
    expect(reorderPending([done, x, y, z], [z.id, x.id, y.id])).toEqual([
      { id: z.id, position: x.position, day: TUE, stage: 'A' },
      { id: x.id, position: y.position, day: WED, stage: 'B' },
      { id: y.id, position: z.position, day: THU, stage: 'B' },
    ]);
  });

  it('resumo: progresso, ação de hoje e quanto o fim escorregou', () => {
    const actions = [action(MON, { doneAt: `${MON}T15:00:00` }), action(WED), action(MON2)];
    const goal: Goal = { id: 1, title: 'x', outcome: '', targetDate: FRI, weekdays: [1, 2, 3, 4, 5], status: 'active', createdAt: '', finishedAt: null, actions };
    const s = summarize(goal, WED);
    expect([s.done, s.total, s.dueToday, s.endDay, s.slipDays]).toEqual([1, 3, true, MON2, 3]);
    expect(summarize(goal, TUE).dueToday).toBe(false);
    expect(summarize(goal, MON).doneToday).toBe(1);
  });

  it('etapas agrupam ações seguidas e o dia sai por extenso', () => {
    const groups = stagesOf([action(MON, { stage: 'A' }), action(TUE, { stage: 'A' }), action(WED, { stage: 'B' })]);
    expect(groups.map((g) => [g.stage, g.actions.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
    expect([fmtDay(MON, MON), fmtDay(TUE, MON), fmtDay(MON2, MON), fmtDay('2027-01-04', MON)]).toEqual(['hoje', 'amanhã', 'seg 21/09', 'seg 04/01/27']);
  });
});

describe('planos no banco', () => {
  it('cria com uma ação por dia de trabalho a partir de hoje', () => {
    const g = repo.createGoal({ ...plan('a', 'b', 'c'), weekdays: [1, 2, 3, 4, 5] }, THU);
    expect(daysOf(g)).toEqual([THU, FRI, MON2]);
    expect(g.actions.every((a) => a.plannedDay === a.day && a.stage === 'Etapa 1')).toBe(true);
  });

  it('virou o dia sem fazer: a trilha escorrega e o dia original fica guardado', () => {
    const g = repo.createGoal({ ...plan('a', 'b'), weekdays: [1, 2, 3, 4, 5], targetDate: TUE }, MON);
    expect(repo.reflowAll(MON)).toBe(false);
    expect(repo.reflowAll(WED)).toBe(true);
    const after = repo.getGoal(g.id) as Goal;
    expect(daysOf(after)).toEqual([WED, THU]);
    expect(after.actions.map((a) => a.plannedDay)).toEqual([MON, TUE]);
    expect(summarize(after, WED).slipDays).toBe(2);
    repo.deleteGoal(g.id);
  });

  it('concluir a última fecha o plano; desfazer reabre e traz a ação para hoje', () => {
    const g = repo.createGoal({ ...plan('a', 'b'), weekdays: [1, 2, 3, 4, 5] }, MON);
    repo.setActionDone(g.actions[0].id, true, MON);
    const done = repo.setActionDone(g.actions[1].id, true, MON);
    expect(done.status).toBe('done');
    const back = repo.setActionDone(g.actions[0].id, false, THU);
    expect(back.status).toBe('active');
    expect(back.actions[0].day).toBe(THU);
    repo.deleteGoal(g.id);
  });

  it('ação feita adiantada puxa as seguintes: amanhã sempre tem a próxima e o fim recua', () => {
    const g = repo.createGoal({ ...plan('a', 'b', 'c', 'd'), weekdays: [1, 2, 3, 4, 5] }, MON);
    const [a, b, c] = g.actions;
    expect(daysOf(repo.setActionDone(a.id, true, MON))).toEqual([MON, TUE, WED, THU]);
    // "b" era de terça e foi feita na segunda: "c" e "d" chegam um dia antes.
    expect(daysOf(repo.setActionDone(b.id, true, MON))).toEqual([MON, TUE, TUE, WED]);
    // "c" (agora de terça) também feita na segunda: "d" vem para terça, nunca para hoje.
    expect(daysOf(repo.setActionDone(c.id, true, MON))).toEqual([MON, TUE, TUE, TUE]);
    repo.deleteGoal(g.id);
  });

  it('à mão: adicionar no meio, mover de dia e apagar empurram só o necessário', () => {
    const g = repo.createGoal({ ...plan('a', 'b', 'c'), weekdays: [1, 2, 3, 4, 5] }, MON);
    const [a, b, c] = g.actions;
    const added = repo.addAction(g.id, { title: 'nova', afterId: a.id }, MON);
    expect(added.actions.map((x) => [x.title, x.day])).toEqual([
      ['a', MON],
      ['nova', TUE],
      ['b', WED],
      ['c', THU],
    ]);
    // Mover "b" para sexta empurra "c" para segunda; antes de "nova" não dá (a ordem manda).
    expect(daysOf(repo.updateAction(b.id, { day: FRI }, MON))).toEqual([MON, TUE, FRI, MON2]);
    expect(repo.updateAction(b.id, { day: MON }, MON).actions.find((x) => x.id === b.id)?.day).toBe(WED);
    const removed = repo.deleteAction(c.id, MON);
    expect(removed.actions.map((x) => x.title)).toEqual(['a', 'nova', 'b']);
    repo.deleteGoal(g.id);
  });

  it('reordenar e refazer o que falta', () => {
    const g = repo.createGoal({ ...plan('a', 'b', 'c'), weekdays: [1, 2, 3, 4, 5] }, MON);
    const [a, b, c] = g.actions;
    repo.setActionDone(a.id, true, MON);
    const swapped = repo.reorderActions(g.id, [c.id, b.id], MON);
    expect(swapped.actions.map((x) => [x.title, x.day])).toEqual([
      ['a', MON],
      ['c', TUE],
      ['b', WED],
    ]);
    const redo = repo.replacePending(g.id, [{ title: 'Nova etapa', actions: ['x', { title: 'y', notes: 'com cuidado' }] }], WED);
    expect(redo.actions.map((x) => [x.title, x.stage, x.day, !!x.doneAt])).toEqual([
      ['a', 'Etapa 1', MON, true],
      ['x', 'Nova etapa', WED, false],
      ['y', 'Nova etapa', THU, false],
    ]);
    expect(redo.actions[2].notes).toBe('com cuidado');
    repo.deleteGoal(g.id);
  });

  it('férias marcadas não entram na trilha', () => {
    setDay(TUE, 'vacation');
    const g = repo.createGoal({ ...plan('a', 'b'), weekdays: [1, 2, 3, 4, 5] }, MON);
    expect(daysOf(g)).toEqual([MON, WED]);
    expect(repo.planEnd(2, [1, 2, 3, 4, 5], MON)).toBe(WED);
    repo.deleteGoal(g.id);
  });
});
