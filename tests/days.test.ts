import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined } }));
const { openDb } = await import('../src/main/db');
const { saveProfile, goalForDate } = await import('../src/main/db/repos/profile');
const days = await import('../src/main/db/repos/days');
const { refreshStreak } = await import('../src/main/insights/streak');
const { refreshMood, computeMood } = await import('../src/main/insights/mood');
const { previousWorkday, wasEmpty } = await import('../src/main/days/flows');
const { statsFor } = await import('../src/main/stats');

const key = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (y: number, m: number, d: number, h = 10): Date => new Date(y, m - 1, d, h);

function setup(): void {
  openDb(':memory:');
  saveProfile({
    name: 'Ana',
    workDays: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '18:00',
    lunchStart: '12:00',
    lunchMin: 60,
    dailyGoalMin: 360,
    goalPerDay: null,
    energyPeak: 'morning',
    focusPreset: { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 },
    presenceLevel: 'balanced',
    interruptBudget: 5,
    tone: 'cute',
    autostart: false,
    onboardedAt: at(2026, 9, 1).toISOString(),
  });
}

/** Um dia bom: 6h30 de foco e uma sessão completa. */
async function goodDay(d: Date): Promise<void> {
  const { db } = await import('../src/main/db');
  db().run("INSERT INTO focus_sessions (started_at, ended_at, preset_json, focused_sec, status) VALUES (?, ?, '{}', ?, 'completed')", d.toISOString(), d.toISOString(), 390 * 60);
}

describe('dias não trabalhados', () => {
  it('folga e feriado não quebram a sequência e ficam fora das médias (4 semanas)', async () => {
    setup();
    // 07/09/2026 (seg) é feriado (Independência); 16/09 (qua) foi folga; o resto dos dias úteis foi bom.
    days.setDay('2026-09-16', 'off');
    const start = at(2026, 9, 7);
    for (let i = 0; i < 26; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 10);
      const k = key(d);
      if (d.getDay() === 0 || d.getDay() === 6 || k === '2026-09-07' || k === '2026-09-16') continue;
      await goodDay(d);
      refreshMood(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18));
    }
    const now = at(2026, 10, 2, 19);
    const s = await refreshStreak(now);
    // 20 dias úteis de 07/09 a 02/10, menos o feriado e a folga = 18 dias bons seguidos.
    expect(s.currentDays).toBe(18);
    expect(goalForDate(null, at(2026, 9, 7))).toBe(360);
    expect(statsFor(at(2026, 9, 7)).goalMin).toBe(0);
    expect(statsFor(at(2026, 9, 16)).goalMin).toBe(0);
    // A folga não entra na média: só dias bons → humor da semana alto.
    const m = computeMood(at(2026, 9, 17, 18));
    expect(m.components.weekAvg).toBeGreaterThanOrEqual(70);
  });

  it('meio período corta a meta; trabalho fora do PC soma às horas', () => {
    setup();
    days.setDay('2026-10-05', 'half');
    days.setDay('2026-10-06', 'offline_work', { minutes: 240 });
    expect(statsFor(at(2026, 10, 5)).goalMin).toBe(180);
    expect(statsFor(at(2026, 10, 6)).workedMin).toBe(240);
  });

  it('dia útil vazio gera exatamente uma pergunta (e só dele)', () => {
    setup();
    // Sexta 02/10 ficou vazia; na segunda 05/10 o "ontem" é a sexta.
    const monday = at(2026, 10, 5, 9);
    const prev = previousWorkday(monday);
    expect(prev && key(prev)).toBe('2026-10-02');
    expect(wasEmpty(prev as Date)).toBe(true);
    days.setDay('2026-10-02', 'off');
    expect(wasEmpty(prev as Date)).toBe(false);
  });

  it('férias em bloco', () => {
    setup();
    expect(days.setRange('2026-12-10', '2026-12-20', 'vacation')).toBe(11);
    expect(days.nextVacation('2026-12-01')).toEqual({ start: '2026-12-10', end: '2026-12-20' });
    expect(days.vacationStart('2026-12-15')).toBe('2026-12-10');
    expect(days.isAbsent('2026-12-12')).toBe(true);
    expect(days.clearRange('2026-12-10', '2026-12-20')).toBe(11);
    expect(days.nextVacation('2026-12-01')).toBeNull();
  });
});
