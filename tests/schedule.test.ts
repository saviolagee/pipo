import { describe, expect, it } from 'vitest';
import { cronMatches, nextRuns, parseSchedule, runsBetween } from '../src/shared/schedule';

describe('agenda em linguagem natural', () => {
  it('converte frases comuns em cron', () => {
    expect(parseSchedule('seg–sex 9h')).toEqual({ cron: '0 9 * * 1,2,3,4,5', label: 'Seg–Sex às 09:00' });
    expect(parseSchedule('de segunda a sexta às 9h30')?.cron).toBe('30 9 * * 1,2,3,4,5');
    expect(parseSchedule('dias úteis às 18h')?.cron).toBe('0 18 * * 1,2,3,4,5');
    expect(parseSchedule('todo dia às 18h')).toEqual({ cron: '0 18 * * *', label: 'Todo dia às 18:00' });
    expect(parseSchedule('toda segunda e quarta 14h')?.cron).toBe('0 14 * * 1,3');
    expect(parseSchedule('toda sexta às 17h')?.cron).toBe('0 17 * * 5');
    expect(parseSchedule('a cada 2h das 8 às 18')?.cron).toBe('0 8-18/2 * * *');
    expect(parseSchedule('a cada 30 min')?.cron).toBe('*/30 * * * *');
    expect(parseSchedule('de hora em hora das 9 às 17 seg a sex')?.cron).toBe('0 9-17/1 * * 1,2,3,4,5');
    expect(parseSchedule('às 9h e às 15h')?.cron).toBe('0 9,15 * * *');
    expect(parseSchedule('dia 1 de cada mês às 9h')?.cron).toBe('0 9 1 * *');
    expect(parseSchedule('às 6 da tarde')?.cron).toBe('0 18 * * *');
    expect(parseSchedule('quando der')).toBeNull();
  });

  it('próximas execuções', () => {
    const from = new Date(2026, 9, 1, 10, 0); // qui 01/10 10:00
    const runs = nextRuns('0 9 * * 1,2,3,4,5', from, 3);
    expect(runs.map((d) => d.toDateString())).toEqual([new Date(2026, 9, 2).toDateString(), new Date(2026, 9, 5).toDateString(), new Date(2026, 9, 6).toDateString()]);
    expect(cronMatches('0 8-18/2 * * *', new Date(2026, 9, 1, 14, 0))).toBe(true);
    expect(cronMatches('0 8-18/2 * * *', new Date(2026, 9, 1, 15, 0))).toBe(false);
    expect(runsBetween('*/2 * * * *', new Date(2026, 9, 1, 10, 0), new Date(2026, 9, 1, 10, 4))).toHaveLength(2);
  });
});
