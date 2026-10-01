// Feriados do Brasil calculados localmente (sem rede) e leitura de períodos em pt-BR ("10 a 20 de dez").

export interface Holiday {
  /** AAAA-MM-DD */
  date: string;
  name: string;
  /** Ponto facultativo nacional (Carnaval, Corpus Christi): muita gente trabalha. */
  optional?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const fromDate = (d: Date): string => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());

/** Domingo de Páscoa (algoritmo gregoriano anônimo / Meeus). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function shift(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function nationalHolidays(year: number): Holiday[] {
  const e = easter(year);
  const fixed: Array<[number, number, string]> = [
    [1, 1, 'Confraternização Universal'],
    [4, 21, 'Tiradentes'],
    [5, 1, 'Dia do Trabalho'],
    [9, 7, 'Independência'],
    [10, 12, 'Nossa Senhora Aparecida'],
    [11, 2, 'Finados'],
    [11, 15, 'Proclamação da República'],
    [11, 20, 'Consciência Negra'],
    [12, 25, 'Natal'],
  ];
  const list: Holiday[] = fixed.map(([m, d, name]) => ({ date: ymd(year, m, d), name }));
  list.push(
    { date: fromDate(shift(e, -48)), name: 'Carnaval (segunda)', optional: true },
    { date: fromDate(shift(e, -47)), name: 'Carnaval (terça)', optional: true },
    { date: fromDate(shift(e, -2)), name: 'Sexta-feira Santa' },
    { date: fromDate(shift(e, 60)), name: 'Corpus Christi', optional: true },
  );
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Feriados estaduais mais conhecidos (data fixa). Municipais: o usuário adiciona os seus. */
export const STATE_HOLIDAYS: Record<string, Array<[number, number, string]>> = {
  SP: [[7, 9, 'Revolução Constitucionalista']],
  RJ: [[4, 23, 'São Jorge']],
  BA: [[7, 2, 'Independência da Bahia']],
  RS: [[9, 20, 'Revolução Farroupilha']],
  CE: [[3, 25, 'Data Magna do Ceará']],
  PE: [[3, 6, 'Revolução Pernambucana']],
  PR: [[12, 19, 'Emancipação do Paraná']],
  DF: [[11, 30, 'Dia do Evangélico']],
  AM: [[9, 5, 'Elevação do Amazonas']],
  PA: [[8, 15, 'Adesão do Pará']],
  MA: [[7, 28, 'Adesão do Maranhão']],
  PI: [[10, 19, 'Dia do Piauí']],
  MS: [[10, 11, 'Criação de Mato Grosso do Sul']],
  TO: [[10, 5, 'Criação do Tocantins']],
};

export interface HolidayPrefs {
  /** UF para os feriados estaduais (ou null). */
  state: string | null;
  /** Datas extras (municipais, ponte, recesso): AAAA-MM-DD ou MM-DD (todo ano). */
  custom: Array<{ date: string; name: string }>;
  /** Nomes de feriados em que a pessoa trabalha mesmo assim (ex.: "Carnaval (segunda)"). */
  worked: string[];
}

export const DEFAULT_HOLIDAY_PREFS: HolidayPrefs = { state: null, custom: [], worked: [] };

export function holidaysFor(year: number, prefs: HolidayPrefs): Holiday[] {
  const list = [...nationalHolidays(year)];
  for (const [m, d, name] of prefs.state ? (STATE_HOLIDAYS[prefs.state] ?? []) : []) list.push({ date: ymd(year, m, d), name });
  for (const c of prefs.custom) {
    if (/^\d{2}-\d{2}$/.test(c.date)) list.push({ date: `${year}-${c.date}`, name: c.name });
    else if (c.date.startsWith(`${year}-`)) list.push({ date: c.date, name: c.name });
  }
  return list.filter((h) => !prefs.worked.includes(h.name)).sort((a, b) => a.date.localeCompare(b.date));
}

export function holidayOn(date: string, prefs: HolidayPrefs): Holiday | null {
  return holidaysFor(Number(date.slice(0, 4)), prefs).find((h) => h.date === date) ?? null;
}

// ---------- Períodos em pt-BR ----------

const MONTHS: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, março: 3, abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6,
  jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12,
};

function monthOf(s: string | undefined): number | null {
  if (!s) return null;
  const k = s.toLowerCase().replace(/\.$/, '');
  return MONTHS[k] ?? MONTHS[k.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? null;
}

/** Próxima ocorrência (hoje ou depois) de dia/mês. */
function nextOccurrence(now: Date, month: number, day: number): Date {
  const y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return candidate < today ? new Date(y + 1, month - 1, day) : candidate;
}

function oneDay(token: string, now: Date): Date | null {
  const t = token.trim().toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!t || t === 'hoje') return today;
  if (t === 'amanhã' || t === 'amanha') return shift(today, 1);
  if (t === 'ontem') return shift(today, -1);
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return y ? new Date(y, Number(m[2]) - 1, Number(m[1])) : nextOccurrence(now, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})\s+de\s+([a-zçã.]+)$/i.exec(t);
  if (m && monthOf(m[2])) return nextOccurrence(now, monthOf(m[2]) as number, Number(m[1]));
  return null;
}

/**
 * "10 a 20 de dez", "10/12 a 05/01", "de 3 a 7 de março", "15/11", "amanhã".
 * Retorna AAAA-MM-DD de início e fim (inclusive), ou null se não entendeu.
 */
export function parseDateRange(text: string, now = new Date()): { start: string; end: string } | null {
  const t = text.trim().toLowerCase().replace(/^de\s+/, '').replace(/\s+/g, ' ');
  const m = /^(.+?)\s+(?:a|até|ate|-)\s+(.+)$/.exec(t);
  if (!m) {
    const d = oneDay(t, now);
    return d ? { start: fromDate(d), end: fromDate(d) } : null;
  }
  let [, a, b] = m;
  // "10 a 20 de dez": o mês do fim vale para o começo.
  const tail = /\s+de\s+([a-zçã.]+)$/i.exec(b);
  if (/^\d{1,2}$/.test(a.trim())) {
    if (tail) a = `${a.trim()} de ${tail[1]}`;
    else if (/^\d{1,2}\/\d{1,2}/.test(b)) a = `${a.trim()}/${b.split('/')[1]}`;
  }
  const start = oneDay(a, now);
  let end = oneDay(b, now);
  if (!start || !end) return null;
  // Fim antes do começo: atravessa o ano (20/12 a 05/01).
  if (end < start) end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate());
  if (end.getFullYear() > start.getFullYear() + 1) end = new Date(start.getFullYear() + 1, end.getMonth(), end.getDate());
  return { start: fromDate(start), end: fromDate(end) };
}
