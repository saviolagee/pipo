// Formatação de durações e datas em pt-BR (usada no main e no renderer).

export function fmtHM(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}min`;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
}

export function fmtTimer(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function fmtDue(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const time = hasTime ? ` ${fmtTime(iso)}` : '';
  if (diff === 0) return `hoje${time}`;
  if (diff === 1) return `amanhã${time}`;
  if (diff === -1) return `ontem${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS_SHORT[d.getDay()]}${time}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}${time}`;
}
