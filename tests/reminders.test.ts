import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dueSlot, listTitles, pushedLines, reminderText, slotTimes } from '../src/shared/reminders';

const dir = mkdtempSync(join(tmpdir(), 'pipo-lembretes-'));
const shown: Array<{ title: string; body: string }> = [];
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  nativeImage: { createFromBuffer: () => ({}) },
  Notification: class {
    static isSupported = (): boolean => true;
    constructor(private o: { title: string; body: string }) {}
    on(): void {}
    show(): void {
      shown.push({ title: this.o.title, body: this.o.body });
    }
  },
  BrowserWindow: class {},
  screen: {},
  dialog: {},
  shell: {},
  protocol: {},
  powerMonitor: {},
}));
const { openDb } = await import('../src/main/db');
const goals = await import('../src/main/db/repos/goals');
const { saveProfile } = await import('../src/main/db/repos/profile');
const { createTask } = await import('../src/main/db/repos/tasks');
const { recordPushed, remindNow, todayItems } = await import('../src/main/reminders');

const min = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

describe('quando lembrar', () => {
  it('três lembretes no expediente: começo, tarde e uma hora antes do fim', () => {
    expect(slotTimes(min('09:00'), min('18:00'))).toEqual({ manha: min('09:00'), tarde: min('14:24'), fim: min('17:00') });
    expect(dueSlot(min('08:59'), min('09:00'), min('18:00'), [])).toBeNull();
    expect(dueSlot(min('09:05'), min('09:00'), min('18:00'), [])).toBe('manha');
    expect(dueSlot(min('09:05'), min('09:00'), min('18:00'), ['manha'])).toBeNull();
    expect(dueSlot(min('15:00'), min('09:00'), min('18:00'), ['manha'])).toBe('tarde');
    expect(dueSlot(min('18:00'), min('09:00'), min('18:00'), [])).toBeNull();
  });
  it('abriu o app tarde: só o lembrete mais recente vale, sem acumular', () => {
    expect(dueSlot(min('17:10'), min('09:00'), min('18:00'), [])).toBe('fim');
    expect(dueSlot(min('17:30'), min('09:00'), min('18:00'), ['fim'])).toBeNull();
    expect(dueSlot(min('15:00'), min('09:00'), min('18:00'), ['fim'])).toBeNull();
  });
});

describe('o que dizer', () => {
  const items = [
    { title: 'Escrever o texto da página', kind: 'trilha' as const },
    { title: 'Enviar NF do mês', kind: 'tarefa' as const },
    { title: 'Ligar pro contador', kind: 'tarefa' as const },
    { title: 'Revisar contrato', kind: 'tarefa' as const },
  ];
  const pushed = [{ kind: 'trilha' as const, title: 'Escrever o texto da página', from: '2026-11-12', to: '2026-11-13', goal: 'Lançar o site', end: '2026-11-27' }];
  const o = { remind: true, pushed: true, today: '2026-11-13' };

  it('lista no máximo três e diz quantas sobram', () => {
    expect(listTitles(items.slice(0, 2))).toBe('“Escrever o texto da página” e “Enviar NF do mês”');
    expect(listTitles(items)).toBe('“Escrever o texto da página”, “Enviar NF do mês”, “Ligar pro contador” e mais 1');
  });

  it('de manhã: o dia e o que passou para frente', () => {
    const r = reminderText('manha', items, pushed, o);
    expect(r?.title).toBe('Hoje: 4 atividades');
    expect(r?.body.split('\n')[0]).toBe('“Escrever o texto da página” passou de ontem para hoje; “Lançar o site” agora termina sex 27/11.');
  });

  it('à tarde sugere uma; no fim avisa que o resto passa para amanhã', () => {
    expect(reminderText('tarde', items.slice(1, 2), [], o)).toEqual({ title: 'Falta 1 atividade de hoje', body: 'Que tal agora: “Enviar NF do mês”?' });
    expect(reminderText('fim', items.slice(0, 2), [], o)?.body).toBe('“Escrever o texto da página” e “Enviar NF do mês”. O que não der hoje passa para amanhã.');
  });

  it('tudo feito: só fala do que passou para frente; sem nada, fica quieto', () => {
    expect(reminderText('tarde', [], pushed, o)?.title).toBe('Uma atividade passou para frente');
    expect(reminderText('tarde', [], [], o)).toBeNull();
    expect(reminderText('manha', items, pushed, { ...o, remind: false })?.title).toBe('Uma atividade passou para frente');
    expect(reminderText('manha', [], pushed, { ...o, pushed: false })).toBeNull();
  });

  it('junta as ações do mesmo plano e as tarefas vencidas', () => {
    const two = [pushed[0], { ...pushed[0], title: 'Montar a página', from: '2026-11-12', to: '2026-11-16', end: '2026-11-30' }];
    expect(pushedLines(two, '2026-11-13')).toEqual(['2 ações de “Lançar o site” passaram para frente (“Escrever o texto da página” e “Montar a página”); o plano agora termina seg 30/11.']);
    expect(pushedLines([{ kind: 'tarefa', title: 'A', from: '2026-11-12', to: '2026-11-13' }, { kind: 'tarefa', title: 'B', from: '2026-11-11', to: '2026-11-13' }], '2026-11-13')).toEqual(['2 tarefas venceram e continuam em Hoje: “A” e “B”.']);
  });

  it('tarefa vencida continua em Hoje', () => {
    expect(pushedLines([{ kind: 'tarefa', title: 'Enviar NF', from: '2026-11-12', to: '2026-11-13' }], '2026-11-13')).toEqual(['“Enviar NF” venceu ontem e continua em Hoje.']);
  });
});

describe('aviso de verdade', () => {
  it('a trilha conta o que empurrou e o lembrete da manhã avisa, uma vez só', () => {
    openDb(':memory:');
    saveProfile({
      name: 'Savio', workDays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchMin: 60, dailyGoalMin: 360, goalPerDay: null,
      energyPeak: 'morning', focusPreset: { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 }, presenceLevel: 'balanced', interruptBudget: 5, tone: 'cute', autostart: false,
      onboardedAt: '2026-11-01T12:00:00.000Z',
    });
    // Plano criado na quarta 11/11: a ação de quarta não foi feita.
    goals.createGoal({ title: 'Lançar o site', stages: [{ title: 'Etapa 1', actions: ['Escrever o texto', 'Montar a página'] }], weekdays: [1, 2, 3, 4, 5] }, '2026-11-11');
    createTask({ title: 'Enviar NF', dueAt: new Date(2026, 10, 12, 10).toISOString() });
    const r = goals.reflowAllDetailed('2026-11-13');
    // As duas ficaram para trás: a de quarta vai para hoje (sexta) e a de quinta, para segunda.
    expect(r.pushed.map((p) => [p.title, p.from, p.to, p.end])).toEqual([
      ['Escrever o texto', '2026-11-11', '2026-11-13', '2026-11-16'],
      ['Montar a página', '2026-11-12', '2026-11-16', '2026-11-16'],
    ]);
    recordPushed(r.pushed);
    const friday = new Date(2026, 10, 13, 9, 5);
    expect(todayItems(friday).map((x) => x.title)).toEqual(['Escrever o texto', 'Enviar NF']);
    const text = remindNow(friday);
    expect(text?.title).toBe('Hoje: 2 atividades');
    expect(text?.body.split('\n')).toEqual([
      '2 ações de “Lançar o site” passaram para frente (“Escrever o texto” e “Montar a página”); o plano agora termina seg 16/11.',
      '“Enviar NF” venceu ontem e continua em Hoje.',
      '“Escrever o texto” e “Enviar NF”',
    ]);
    expect(shown).toHaveLength(1);
    // Mesmo slot de novo: nada. O que passou para frente não se repete à tarde.
    expect(remindNow(new Date(2026, 10, 13, 9, 30))).toBeNull();
    const afternoon = remindNow(new Date(2026, 10, 13, 15, 0));
    expect(afternoon?.title).toBe('Faltam 2 atividades de hoje');
    expect(afternoon?.body).toBe('Que tal agora: “Escrever o texto”?');
    // Sábado: não é dia de trabalho.
    expect(remindNow(new Date(2026, 10, 14, 10, 0))).toBeNull();
  });
});
