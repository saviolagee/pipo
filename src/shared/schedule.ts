// Agenda em linguagem natural (pt-BR) → cron local de 5 campos, e próximas execuções.
// "seg–sex 9h", "todo dia às 18h", "a cada 2h das 8 às 18", "toda segunda e quarta 14h30",
// "a cada 30 min", "dia 1 de cada mês às 9h", "às 9h e às 15h". Puro: tests/schedule.test.ts.

const DAYS: Array<[RegExp, number]> = [
  [/\bdom(ingo)?s?\b/, 0],
  [/\bseg(unda)?s?(-feira)?\b/, 1],
  [/\bter(ça|ca)?s?(-feira)?\b/, 2],
  [/\bqua(rta)?s?(-feira)?\b/, 3],
  [/\bqui(nta)?s?(-feira)?\b/, 4],
  [/\bsex(ta)?s?(-feira)?\b/, 5],
  [/\bs[áa]b(ado)?s?\b/, 6],
];

function dayIndex(word: string): number | null {
  for (const [re, d] of DAYS) if (re.test(word)) return d;
  return null;
}

/** "9h", "9h30", "09:30", "9 da manhã", "6 da tarde", "18" → [h, m] */
function parseTimes(t: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?|\b(\d{1,2})\s*(?:horas?)?\s*da\s*(manh[ãa]|tarde|noite)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m[1] !== undefined) out.push([Number(m[1]), Number(m[2] ?? 0)]);
    else {
      let h = Number(m[3]);
      if (/tarde|noite/.test(m[4]) && h < 12) h += 12;
      out.push([h, 0]);
    }
  }
  // "às 18" sem h
  if (!out.length) {
    const a = /\b(?:às|as|ao?s?)\s+(\d{1,2})\b/.exec(t);
    if (a) out.push([Number(a[1]), 0]);
  }
  return out.filter(([h, mm]) => h >= 0 && h <= 23 && mm >= 0 && mm <= 59);
}

function weekdays(t: string): number[] | null {
  if (/\b(dias? [úu]teis|seg(unda)?\s*(?:a|–|-|até)\s*sex(ta)?)\b/.test(t)) return [1, 2, 3, 4, 5];
  if (/\b(fins? de semana|fim de semana)\b/.test(t)) return [0, 6];
  const range = /\b(dom|seg|ter|qua|qui|sex|s[áa]b)\w*\s*(?:a|–|-|até)\s*(dom|seg|ter|qua|qui|sex|s[áa]b)\w*/.exec(t);
  if (range) {
    const a = dayIndex(range[1]) as number;
    const b = dayIndex(range[2]) as number;
    const out: number[] = [];
    for (let d = a; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break;
    }
    return out;
  }
  const found = new Set<number>();
  for (const w of t.split(/[\s,]+|\be\b/)) {
    const d = dayIndex(w);
    if (d !== null) found.add(d);
  }
  return found.size ? [...found].sort() : null;
}

export interface ParsedSchedule {
  cron: string;
  /** Descrição normalizada ("Seg–Sex às 09:00"). */
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function daysLabel(days: number[] | null): string {
  if (!days || days.length === 7) return 'Todo dia';
  if (days.join() === '1,2,3,4,5') return 'Seg–Sex';
  if (days.join() === '0,6') return 'Sáb e Dom';
  return days.map((d) => DAY_SHORT[d]).join(', ');
}

export function parseSchedule(text: string): ParsedSchedule | null {
  const t = ` ${text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()} `;
  const days = weekdays(t);
  const dow = days && days.length < 7 ? days.join(',') : '*';

  // Intervalos: "a cada 2h", "a cada 30 min", "de hora em hora", com janela opcional "das 8 às 18".
  const every = /a cada\s+(\d+)\s*(h|hora|horas|min|minuto|minutos)\b/.exec(t) ?? (/de hora em hora/.test(t) ? ['', '1', 'h'] : null);
  if (every) {
    const n = Number(every[1]);
    const isMin = /^min/.test(every[2]);
    const win = /das?\s+(\d{1,2})(?:h|:00)?\s*(?:às|as|até|a)\s+(\d{1,2})/.exec(t);
    const hours = win ? `${Number(win[1])}-${Number(win[2])}` : '*';
    if (isMin) {
      if (n < 5 || n > 59) return null;
      return { cron: `*/${n} ${hours} * * ${dow}`, label: `A cada ${n} min${win ? ` das ${pad(Number(win[1]))}h às ${pad(Number(win[2]))}h` : ''}${dow !== '*' ? ` (${daysLabel(days)})` : ''}` };
    }
    if (n < 1 || n > 23) return null;
    const hourField = win ? `${Number(win[1])}-${Number(win[2])}/${n}` : `*/${n}`;
    return { cron: `0 ${hourField} * * ${dow}`, label: `A cada ${n}h${win ? ` das ${pad(Number(win[1]))}h às ${pad(Number(win[2]))}h` : ''}${dow !== '*' ? ` (${daysLabel(days)})` : ''}` };
  }

  const times = parseTimes(t);
  if (!times.length) return null;
  const minutes = [...new Set(times.map(([, m]) => m))];
  // Horários com minutos diferentes não cabem num cron só: usa o primeiro minuto.
  const minute = minutes.length === 1 ? minutes[0] : times[0][1];
  const hours = [...new Set(times.map(([h]) => h))].sort((a, b) => a - b);
  const timeLabel = times.map(([h, m]) => `${pad(h)}:${pad(m)}`).join(' e ');

  // Mensal: "dia 1 de cada mês", "todo dia 15".
  const monthly = /\b(?:todo\s+)?dia\s+(\d{1,2})\b(?!\s+de\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))/.exec(t);
  if (monthly && /(m[eê]s|todo dia \d)/.test(t)) {
    const dom = Number(monthly[1]);
    if (dom < 1 || dom > 31) return null;
    return { cron: `${minute} ${hours.join(',')} ${dom} * *`, label: `Dia ${dom} de cada mês às ${timeLabel}` };
  }
  return { cron: `${minute} ${hours.join(',')} * * ${dow}`, label: `${daysLabel(days)} às ${timeLabel}` };
}

// ---------- Cron ----------

function field(spec: string, value: number, min: number, max: number): boolean {
  for (const part of spec.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart !== '*') {
      const [a, b] = rangePart.split('-').map(Number);
      lo = a;
      hi = b ?? (stepPart ? max : a);
    }
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
  }
  return false;
}

export function cronMatches(cron: string, d: Date): boolean {
  const [mi, h, dom, mon, dow] = cron.trim().split(/\s+/);
  return field(mi, d.getMinutes(), 0, 59) && field(h, d.getHours(), 0, 23) && field(dom, d.getDate(), 1, 31) && field(mon, d.getMonth() + 1, 1, 12) && field(dow, d.getDay(), 0, 6);
}

/** Próximas `n` execuções depois de `from` (minuto a minuto, até 60 dias). */
export function nextRuns(cron: string, from: Date, n = 3): Date[] {
  const out: Date[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1);
  const limit = from.getTime() + 60 * 86_400_000;
  while (out.length < n && d.getTime() < limit) {
    if (cronMatches(cron, d)) out.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

/** Horários agendados no intervalo (de, até], do mais antigo para o mais novo. */
export function runsBetween(cron: string, from: Date, to: Date, max = 1000): Date[] {
  const out: Date[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1);
  while (d.getTime() <= to.getTime() && out.length < max) {
    if (cronMatches(cron, d)) out.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}
