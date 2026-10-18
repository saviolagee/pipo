import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-dash-'));
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
const { openDb, db } = await import('../src/main/db');
const { saveProfile } = await import('../src/main/db/repos/profile');
const days = await import('../src/main/db/repos/days');
const { dashboardData, rangeFor } = await import('../src/main/dashboard/data');
const repo = await import('../src/main/pipos/repo');
const { EMPTY_PLAYBOOK } = await import('../src/shared/pipos');

const at = (y: number, m: number, d: number, h = 10): Date => new Date(y, m - 1, d, h);

function setup(): void {
  openDb(':memory:');
  saveProfile({
    name: 'Ana', workDays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchMin: 60, dailyGoalMin: 360, goalPerDay: null,
    energyPeak: 'morning', focusPreset: { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 }, presenceLevel: 'balanced', interruptBudget: 5, tone: 'cute', autostart: false,
    onboardedAt: at(2026, 8, 1).toISOString(),
  });
}

/** Uma tarefa marcada como feita em `when`. */
function done(title: string, when: Date, clientId: number | null = null): void {
  db().run(
    "INSERT INTO tasks (title, status, source, is_today, position, created_at, updated_at, completed_at, priority, client_id) VALUES (?, 'done', 'manual', 0, 0, ?, ?, ?, 2, ?)",
    title,
    when.toISOString(),
    when.toISOString(),
    when.toISOString(),
    clientId,
  );
}

describe('dashboards', () => {
  it('um mês com folga, férias, feriado e sábado: conta dias com atividade e o que foi feito', async () => {
    setup();
    days.setDay('2026-09-16', 'off');
    days.setRange('2026-09-21', '2026-09-25', 'vacation');
    const client = db().run("INSERT INTO clients (name, color, keywords_json, archived) VALUES ('Acme', '#d95926', '[]', 0)").lastId;
    // Dias úteis: 2 tarefas às 9h; sábado 12/09: 1 tarefa às 10h (fora do expediente); 07/09 é feriado.
    for (let d = at(2026, 9, 1); d <= at(2026, 9, 30); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const wd = d.getDay();
      if (k === '2026-09-12') done('Sábado', new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10));
      if (wd === 0 || wd === 6 || ['2026-09-07', '2026-09-16'].includes(k) || (k >= '2026-09-21' && k <= '2026-09-25')) continue;
      done(`A ${k}`, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), k === '2026-09-30' ? client : null);
      done(`B ${k}`, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30));
    }
    // Um plano da trilha com 6 ações: 4 feitas de 01/09 a 04/09, às 14h.
    const goal = db().run("INSERT INTO goals (title, created_at) VALUES ('Lançar o site', ?)", at(2026, 8, 30).toISOString()).lastId;
    for (let i = 0; i < 6; i++) {
      const doneAt = i < 4 ? at(2026, 9, 1 + i, 14).toISOString() : null;
      db().run('INSERT INTO goal_actions (goal_id, title, position, day, planned_day, done_at) VALUES (?, ?, ?, ?, ?, ?)', goal, `Ação ${i + 1}`, i, '2026-09-0' + (i + 1), '2026-09-0' + (i + 1), doneAt);
    }

    const r = await dashboardData(rangeFor('month', at(2026, 9, 15)), at(2026, 10, 1, 12));
    const t = r.totals;
    // 22 dias úteis em set/2026 − feriado − folga − 5 de férias = 15, todos com atividade; mais o sábado.
    expect([t.workdays, t.activeWorkdays, t.activeDays]).toEqual([15, 15, 16]);
    expect([t.tasksDone, t.actionsDone, t.done, t.created]).toEqual([31, 4, 35, 31]);
    expect(t.bestDay).toEqual({ date: '2026-09-04', done: 3 });
    // Folga, férias, feriado e fim de semana não quebram nem contam (como na sequência).
    expect(t.longestRun).toBe(15);
    expect([t.vacationDays, t.daysOff, t.holidays]).toEqual([5, 1, 1]);
    expect(r.days.find((x) => x.date === '2026-09-21')?.status).toBe('vacation');
    expect(r.days.find((x) => x.date === '2026-09-12')).toMatchObject({ done: 1, workday: false });
    // Ritmo: 30 às 9h nos dias úteis, 1 sábado às 10h e as 4 ações às 14h.
    const byHour = new Array<number>(24).fill(0);
    r.rhythm.forEach((row) => row.forEach((n, h) => (byHour[h] += n)));
    expect([byHour[9], byHour[10], byHour[14]]).toEqual([30, 1, 4]);
    expect(r.rhythm[6][10]).toBe(1);
    // O que foi feito: do mais novo para o mais antigo, com o cliente e o plano.
    expect(r.activities[0]).toMatchObject({ date: '2026-09-30', title: 'B 2026-09-30', kind: 'task' });
    expect(r.activities.find((x) => x.title === 'A 2026-09-30')?.where).toBe('Acme');
    expect(r.activities.find((x) => x.kind === 'action')?.where).toBe('Lançar o site');
    expect(r.clients.find((c) => c.name === 'Acme')).toMatchObject({ done: 1, open: 0 });
    expect(r.goals).toEqual([{ id: goal, title: 'Lançar o site', status: 'active', doneInRange: 4, done: 4, total: 6 }]);
  });

  it('métricas em etapas viram funil, por versão', async () => {
    setup();
    const p = repo.createPipo({ name: 'Prospector', color: 'orange', personality: { mission: '', tone: '', never: [] } });
    const metrics = [
      { key: 'leads', label: 'leads', from: '1', stage: 1 },
      { key: 'enviados', label: 'enviados', from: '1', stage: 2 },
      { key: 'respostas', label: 'respostas', from: '1', stage: 3 },
    ];
    repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'A' }], metrics }, 'v1');
    const run = (v: number, m: Record<string, number>): void => {
      const r = repo.createRun(p.id, v, 'manual', false, null, []);
      repo.finishRun(r.id, 'done', { metrics: m, summary: 'ok' });
    };
    run(1, { leads: 50, enviados: 45, respostas: 3 });
    repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'A' }], metrics }, 'assunto novo');
    run(2, { leads: 40, enviados: 38, respostas: 6 });
    const r = await dashboardData(rangeFor('week'));
    const t = r.team.find((x) => x.pipoId === p.id)!;
    expect(t.runs).toBe(2);
    expect(t.metrics.map((m) => [m.label, m.total, m.stage])).toEqual([['leads', 90, 1], ['enviados', 83, 2], ['respostas', 9, 3]]);
    expect(t.versions.map((v) => [v.version, v.metrics.respostas])).toEqual([[1, 3], [2, 6]]);
  });
});
