// Utilitários de data no fuso local da máquina.

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Início e fim (exclusivo) do dia local, em ISO UTC (para comparar com as colunas *_at). */
export function dayRange(d: Date): { start: string; end: string } {
  const s = startOfDay(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { start: s.toISOString(), end: e.toISOString() };
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutos de sobreposição entre dois intervalos ISO. */
export function overlapMin(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = Math.max(Date.parse(aStart), Date.parse(bStart));
  const e = Math.min(Date.parse(aEnd), Date.parse(bEnd));
  return Math.max(0, (e - s) / 60_000);
}
