import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLIDAY_PREFS, easter, holidayOn, holidaysFor, nationalHolidays, parseDateRange } from '../src/shared/holidays';

const names = (y: number): Record<string, string> => Object.fromEntries(nationalHolidays(y).map((h) => [h.name, h.date]));

describe('feriados', () => {
  it('Páscoa e móveis de 2026 e 2027 batem com o calendário oficial', () => {
    expect(easter(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easter(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
    const y26 = names(2026);
    expect(y26['Carnaval (segunda)']).toBe('2026-02-16');
    expect(y26['Carnaval (terça)']).toBe('2026-02-17');
    expect(y26['Sexta-feira Santa']).toBe('2026-04-03');
    expect(y26['Corpus Christi']).toBe('2026-06-04');
    const y27 = names(2027);
    expect(y27['Carnaval (segunda)']).toBe('2027-02-08');
    expect(y27['Carnaval (terça)']).toBe('2027-02-09');
    expect(y27['Sexta-feira Santa']).toBe('2027-03-26');
    expect(y27['Corpus Christi']).toBe('2027-05-27');
    expect(y26['Consciência Negra']).toBe('2026-11-20');
    expect(nationalHolidays(2026)).toHaveLength(13);
  });

  it('estaduais, personalizados e "trabalho nesse feriado"', () => {
    const prefs = { state: 'SP', custom: [{ date: '01-25', name: 'Aniversário de SP' }], worked: ['Carnaval (segunda)'] };
    expect(holidayOn('2026-07-09', prefs)?.name).toBe('Revolução Constitucionalista');
    expect(holidayOn('2026-01-25', prefs)?.name).toBe('Aniversário de SP');
    expect(holidayOn('2026-02-16', prefs)).toBeNull();
    expect(holidayOn('2026-02-17', prefs)?.name).toBe('Carnaval (terça)');
    expect(holidaysFor(2026, DEFAULT_HOLIDAY_PREFS).some((h) => h.date === '2026-07-09')).toBe(false);
  });
});

describe('parseDateRange', () => {
  const now = new Date(2026, 9, 1); // 1/out/2026
  it('entende períodos em pt-BR', () => {
    expect(parseDateRange('10 a 20 de dez', now)).toEqual({ start: '2026-12-10', end: '2026-12-20' });
    expect(parseDateRange('de 3 a 7 de março', now)).toEqual({ start: '2027-03-03', end: '2027-03-07' });
    expect(parseDateRange('20/12 a 05/01', now)).toEqual({ start: '2026-12-20', end: '2027-01-05' });
    expect(parseDateRange('10 a 14/11', now)).toEqual({ start: '2026-11-10', end: '2026-11-14' });
    expect(parseDateRange('15/11', now)).toEqual({ start: '2026-11-15', end: '2026-11-15' });
    expect(parseDateRange('amanhã', now)).toEqual({ start: '2026-10-02', end: '2026-10-02' });
    expect(parseDateRange('hoje', now)).toEqual({ start: '2026-10-01', end: '2026-10-01' });
    expect(parseDateRange('qualquer coisa', now)).toBeNull();
  });
});
