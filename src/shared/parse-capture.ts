// Parser de linguagem natural para captura de tarefas em pt-BR (fallback quando o Claude não está disponível).
// Ex.: "ligar pro Leo sexta 10h #prosaude ~15min !!" → título, data, cliente, estimativa, prioridade.
import type { Client, ParsedCapture, Priority } from './types';

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bdomingo\b/, 0],
  [/\bsegunda(?:-feira)?\b/, 1],
  [/\bter[cç]a(?:-feira)?\b/, 2],
  [/\bquarta(?:-feira)?\b/, 3],
  [/\bquinta(?:-feira)?\b/, 4],
  [/\bsexta(?:-feira)?\b/, 5],
  [/\bs[aá]bado\b/, 6],
];

const MONTHS = ['janeiro', 'fevereiro', 'mar[cç]o', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

interface Found {
  date: Date | null;
  hour: number | null;
  minute: number;
  spans: Array<[number, number]>;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Remove trechos (índices no texto original) e limpa preposições soltas no fim. */
function strip(text: string, spans: Array<[number, number]>): string {
  const sorted = [...spans].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [s, e] of sorted) out = out.slice(0, s) + ' ' + out.slice(e);
  out = out.replace(/\s+/g, ' ').trim();
  // preposições/artigos que sobram no fim: "ligar pro Leo na", "reunião às", "até"
  for (let i = 0; i < 3; i++) out = out.replace(/\s+(na|no|n[ao]s?|em|de|da|do|à|as|às|a|ate|até|para|pra|pro|dia|pela|pelo|antes|depois|ate as|até às)$/i, '').trim();
  return out;
}

function findAll(lower: string, re: RegExp): RegExpExecArray[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(lower))) out.push(m);
  return out;
}

function parseWhen(text: string, now: Date): Found {
  // Trabalha numa cópia normalizada com o mesmo comprimento (acentos removidos 1:1 via NFD+filtro não preserva índices),
  // então normalizamos caractere a caractere para manter os índices.
  const lower = [...text].map((ch) => normalize(ch) || ch).join('');
  const f: Found = { date: null, hour: null, minute: 0, spans: [] };
  const today = startOfDay(now);

  const take = (m: RegExpExecArray): void => {
    f.spans.push([m.index, m.index + m[0].length]);
  };

  // Datas relativas.
  let m = /\bdepois de amanha\b/.exec(lower);
  if (m) {
    f.date = new Date(today.getTime() + 2 * 86_400_000);
    take(m);
  }
  if (!f.date && (m = /\bamanha\b/.exec(lower))) {
    f.date = new Date(today.getTime() + 86_400_000);
    take(m);
  }
  if (!f.date && (m = /\bhoje\b/.exec(lower))) {
    f.date = today;
    take(m);
  }
  if (!f.date && (m = /\bem (\d{1,2}) dias?\b/.exec(lower))) {
    f.date = new Date(today.getTime() + Number(m[1]) * 86_400_000);
    take(m);
  }
  if (!f.date && (m = /\b(semana que vem|proxima semana)\b/.exec(lower))) {
    const d = new Date(today);
    const delta = ((8 - d.getDay()) % 7) || 7; // próxima segunda
    d.setDate(d.getDate() + delta);
    f.date = d;
    take(m);
  }
  if (!f.date && (m = /\b(?:dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower))) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month, day);
    if (!m[3] && d < today) d = new Date(year + 1, month, day);
    if (day >= 1 && day <= 31 && month >= 0 && month < 12) {
      f.date = d;
      take(m);
    }
  }
  if (!f.date && (m = new RegExp(`\\b(?:dia )?(\\d{1,2}) de (${MONTHS.join('|')})\\b`).exec(lower))) {
    const day = Number(m[1]);
    const month = MONTHS.findIndex((mm) => new RegExp(`^${mm}$`).test(m![2]));
    let d = new Date(now.getFullYear(), month, day);
    if (d < today) d = new Date(now.getFullYear() + 1, month, day);
    f.date = d;
    take(m);
  }
  if (!f.date && (m = /\bdia (\d{1,2})\b/.exec(lower))) {
    const day = Number(m[1]);
    let d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d < today) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
    f.date = d;
    take(m);
  }
  if (!f.date) {
    for (const [re, wd] of WEEKDAYS) {
      const mm = new RegExp(`\\b(?:(?:na|no|nesta|neste|esta|este|proxima|proximo)\\s+)?${re.source.replace(/\\b/g, '')}(?:\\s+que vem)?\\b`).exec(lower);
      if (mm) {
        const d = new Date(today);
        let delta = (wd - d.getDay() + 7) % 7;
        if (/proxim|que vem/.test(mm[0]) && delta === 0) delta = 7;
        d.setDate(d.getDate() + delta);
        f.date = d;
        take(mm);
        break;
      }
    }
  }

  // Horários.
  const timeRes: RegExp[] = [
    /\b(?:as |a |ate as |ate )?(\d{1,2})[:h](\d{2})\b/,
    /\b(?:as |a |ate as |ate )?(\d{1,2}) ?h(?:rs?|oras?)?\b/,
    /\bas (\d{1,2})\b(?! ?(?:min|dias?))/,
  ];
  for (const re of timeRes) {
    const mm = findAll(lower, re).find((x) => !f.spans.some(([s, e]) => x.index < e && x.index + x[0].length > s));
    if (mm) {
      const h = Number(mm[1]);
      const mi = mm[2] ? Number(mm[2]) : 0;
      if (h <= 23 && mi <= 59) {
        f.hour = h;
        f.minute = mi;
        take(mm);
        break;
      }
    }
  }
  if (f.hour === null) {
    const parts: Array<[RegExp, number]> = [
      [/\b(?:de |pela |na )?manha\b/, 9],
      [/\bmeio[- ]dia\b/, 12],
      [/\b(?:a |de |pela |na )?tarde\b/, 14],
      [/\b(?:a |de |pela |na )?noite\b/, 19],
    ];
    for (const [re, h] of parts) {
      const mm = re.exec(lower);
      if (mm) {
        f.hour = h;
        take(mm);
        break;
      }
    }
  }
  return f;
}

export function parseCapture(text: string, clients: Client[], now = new Date()): ParsedCapture {
  let work = text;
  const spans: Array<[number, number]> = [];

  // Estimativa: ~15min, ~1h, ~1h30, ~45m
  let estimateMin: number | null = null;
  const est = /~\s*(\d+)\s*(h|hr|hrs|horas?)?\s*(\d{1,2})?\s*(min|m)?\b/i.exec(work);
  if (est) {
    const n = Number(est[1]);
    estimateMin = est[2] ? n * 60 + (est[3] ? Number(est[3]) : 0) : n;
    spans.push([est.index, est.index + est[0].length]);
  }

  // Cliente: #tag
  let clientId: number | null = null;
  for (const m of findAll(work, /#([\p{L}\p{N}_-]+)/u)) {
    const tag = normalize(m[1]);
    const c = clients.find((cl) => normalize(cl.name).replace(/[^a-z0-9]/g, '') === tag.replace(/[^a-z0-9]/g, '') || cl.keywords.some((k) => normalize(k) === tag));
    if (c) clientId = c.id;
    spans.push([m.index, m.index + m[0].length]);
  }

  // Prioridade: "!" ou "urgente" → alta (3).
  let priority: Priority = 2;
  const bang = /(^|\s)(!{1,3})(?=\s|$)/.exec(work);
  if (bang) {
    priority = 3;
    spans.push([bang.index + bang[1].length, bang.index + bang[0].length]);
  }
  if (/\burgente\b/i.test(work)) priority = 3;

  // Mascara os trechos já usados para não confundir o parser de datas (ex.: ~15min).
  work = [...work].map((ch, i) => (spans.some(([s, e]) => i >= s && i < e) ? ' ' : ch)).join('');
  const when = parseWhen(work, now);
  spans.push(...when.spans);

  let dueAt: string | null = null;
  if (when.date || when.hour !== null) {
    const d = when.date ? new Date(when.date) : startOfDay(now);
    if (when.hour !== null) d.setHours(when.hour, when.minute, 0, 0);
    // Só horário, já passou hoje → amanhã.
    if (!when.date && when.hour !== null && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    dueAt = d.toISOString();
  }

  const title = strip(text, spans) || text.trim();
  return { title: title.charAt(0).toUpperCase() + title.slice(1), dueAt, estimateMin, clientId, priority };
}
