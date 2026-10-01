// Dias não trabalhados: registros do usuário + feriados calculados (seção 4.4 do plano V2).
import { DEFAULT_HOLIDAY_PREFS, holidayOn, type HolidayPrefs } from '@shared/holidays';
import type { DayKind, DayStatus } from '@shared/types';
import { db } from '../index';
import { getKV, setKV } from './settings';

interface Row {
  date: string;
  kind: DayKind;
  minutes: number | null;
  note: string | null;
  source: string;
}

/** Tipos que contam como ausência: meta zero, fora das médias, não quebram a sequência. */
export const ABSENT: DayKind[] = ['off', 'vacation', 'holiday', 'sick'];
/** Dias neutros: não entram nas médias e não quebram a sequência (mas também não contam). */
export const NEUTRAL: DayKind[] = [...ABSENT, 'no_record'];

export function holidayPrefs(): HolidayPrefs {
  return { ...DEFAULT_HOLIDAY_PREFS, ...getKV<Partial<HolidayPrefs>>('holidays', {}) };
}

export function setHolidayPrefs(p: HolidayPrefs): HolidayPrefs {
  setKV('holidays', p);
  return p;
}

/** Registro salvo pelo usuário, sem considerar feriados. */
export function storedDay(date: string): DayStatus | null {
  const r = db().get<Row>('SELECT date, kind, minutes, note, source FROM day_status WHERE date = ?', date);
  return r ? { date: r.date, kind: r.kind, minutes: r.minutes, note: r.note, source: r.source } : null;
}

/** Status do dia: o que o usuário disse vale mais que o feriado calculado. */
export function dayStatus(date: string): DayStatus | null {
  const stored = storedDay(date);
  if (stored) return stored;
  const h = holidayOn(date, holidayPrefs());
  return h ? { date, kind: 'holiday', minutes: null, note: h.name, source: 'holiday' } : null;
}

export function isAbsent(date: string): boolean {
  const s = dayStatus(date);
  return !!s && ABSENT.includes(s.kind);
}

export function isNeutral(date: string): boolean {
  const s = dayStatus(date);
  return !!s && NEUTRAL.includes(s.kind);
}

/** Fator da meta do dia: 0 em ausência, 0,5 em meio período. */
export function goalFactor(date: string): number {
  const s = dayStatus(date);
  if (!s) return 1;
  if (ABSENT.includes(s.kind)) return 0;
  if (s.kind === 'half') return 0.5;
  return 1;
}

/** Minutos trabalhados fora do PC informados para o dia. */
export function offlineMinutes(date: string): number {
  const s = storedDay(date);
  return s?.kind === 'offline_work' ? (s.minutes ?? 0) : 0;
}

export function setDay(date: string, kind: DayKind, opts: { minutes?: number | null; note?: string | null; source?: string } = {}): DayStatus {
  db().run(
    `INSERT INTO day_status (date, kind, minutes, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, minutes = excluded.minutes, note = excluded.note, source = excluded.source`,
    date,
    kind,
    opts.minutes ?? null,
    opts.note ?? null,
    opts.source ?? 'user',
    new Date().toISOString(),
  );
  return storedDay(date) as DayStatus;
}

export function clearDay(date: string): void {
  db().run('DELETE FROM day_status WHERE date = ?', date);
}

/** Marca um período inteiro (férias). Datas em AAAA-MM-DD, inclusive. */
export function setRange(start: string, end: string, kind: DayKind, note: string | null = null): number {
  let n = 0;
  db().tx(() => {
    for (let d = parse(start); key(d) <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      setDay(key(d), kind, { note, source: 'user' });
      n++;
    }
  });
  return n;
}

export function clearRange(start: string, end: string): number {
  return db().run('DELETE FROM day_status WHERE date >= ? AND date <= ?', start, end).changes;
}

export function listDays(start: string, end: string): DayStatus[] {
  return db()
    .all<Row>('SELECT date, kind, minutes, note, source FROM day_status WHERE date >= ? AND date <= ? ORDER BY date', start, end)
    .map((r) => ({ date: r.date, kind: r.kind, minutes: r.minutes, note: r.note, source: r.source }));
}

/** Próximo bloco de férias a partir de hoje (dias contíguos). */
export function nextVacation(fromDate: string): { start: string; end: string } | null {
  const first = db().get<{ date: string }>("SELECT date FROM day_status WHERE kind = 'vacation' AND date >= ? ORDER BY date LIMIT 1", fromDate);
  if (!first) return null;
  return { start: first.date, end: vacationEnd(first.date) };
}

/** Último dia do bloco de férias que contém `date`. */
export function vacationEnd(date: string): string {
  let d = parse(date);
  for (;;) {
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (storedDay(key(n))?.kind !== 'vacation') return key(d);
    d = n;
  }
}

/** Primeiro dia do bloco de férias que contém `date`. */
export function vacationStart(date: string): string {
  let d = parse(date);
  for (;;) {
    const p = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    if (storedDay(key(p))?.kind !== 'vacation') return key(d);
    d = p;
  }
}

const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const key = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
