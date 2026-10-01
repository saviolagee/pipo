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

function focus(start: Date, min: number): void {
  db().run("INSERT INTO focus_sessions (started_at, ended_at, preset_json, focused_sec, distracted_sec, status) VALUES (?, ?, '{}', ?, 300, 'completed')", start.toISOString(), new Date(start.getTime() + min * 60_000).toISOString(), min * 60);
}

describe('dashboards', () => {
  it('4 semanas com folga, férias e fim de semana trabalhado: cada número bate com o banco', async () => {
    setup();
    days.setDay('2026-09-16', 'off');
    days.setRange('2026-09-21', '2026-09-25', 'vacation');
    // Dias úteis: 5h de foco às 9h; sábado 12/09: 2h (extra); 07/09 é feriado.
    for (let d = at(2026, 9, 1); d <= at(2026, 9, 30); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const wd = d.getDay();
      if (k === '2026-09-12') focus(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10), 120);
      if (wd === 0 || wd === 6 || ['2026-09-07', '2026-09-16'].includes(k) || (k >= '2026-09-21' && k <= '2026-09-25')) continue;
      focus(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), 300);
    }
    const r = await dashboardData(rangeFor('month', at(2026, 9, 15)), at(2026, 10, 1, 12));
    // 22 dias úteis em set/2026 − feriado − folga − 5 de férias = 15 dias de 5h + 2h no sábado.
    expect(r.totals.workedMin).toBe(15 * 300 + 120);
    expect(r.totals.extraMin).toBe(120);
    expect(r.totals.goalMin).toBe(15 * 360);
    expect(r.totals.vacationDays).toBe(5);
    expect(r.totals.daysOff).toBe(1);
    expect(r.totals.holidays).toBe(1);
    expect(r.days.find((d) => d.date === '2026-09-21')?.status).toBe('vacation');
    expect(r.days.find((d) => d.date === '2026-09-12')?.extraMin).toBe(120);
    // Ritmo: tudo entre 9h e 14h nos dias úteis; sábado às 10h.
    const byHour = new Array<number>(24).fill(0);
    r.rhythm.forEach((row) => row.forEach((m, h) => (byHour[h] += m)));
    expect(byHour[9]).toBe(15 * 60);
    expect(r.rhythm[6][10]).toBe(60);
    expect(byHour.reduce((a, b) => a + b, 0)).toBe(15 * 300 + 120);
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
