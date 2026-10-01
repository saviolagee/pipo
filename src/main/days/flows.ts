// Dias não trabalhados (Fase 15): pergunta "ontem não te vi", férias planejadas, volta das férias,
// trabalho em fim de semana virando padrão. Nada disso gasta o orçamento de interrupções.
import { holidaysFor } from '@shared/holidays';
import type { DayKind, DayStatus, Weekday } from '@shared/types';
import { emit } from '../bus';
import { showCard } from '../cards';
import {
  clearDay,
  clearRange,
  dayStatus,
  holidayPrefs,
  isAbsent,
  listDays,
  nextVacation,
  setDay as saveDay,
  setHolidayPrefs,
  setRange,
  storedDay,
  vacationStart,
} from '../db/repos/days';
import { getKV, setKV } from '../db/repos/settings';
import { getProfile, goalForDate } from '../db/repos/profile';
import { listTasks } from '../db/repos/tasks';
import { focusState } from '../focus/session';
import { debugHooks } from '../debug';
import { handle } from '../ipc';
import { providers } from '../bootstrap';
import { every } from '../scheduler';
import { statsFor } from '../stats';
import { addDays, dayKey } from '../time';

const parseKey = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const br = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

/** Avisa o renderer do status de hoje (pijama, frase) e recalcula metas/humor. */
export function dayChanged(): void {
  emit('day:today', dayStatus(dayKey(new Date())));
  emit('stats:changed', providers.stats());
  dayHooks.changed?.();
}

/** Preenchido pelos insights (recalcular humor e sequência quando um dia muda). */
export const dayHooks: { changed: (() => void) | null } = { changed: null };

function isScheduledWorkday(d: Date): boolean {
  const p = getProfile();
  return !!p && p.workDays.includes(d.getDay() as Weekday);
}

/** Último dia útil antes de hoje (até 7 dias), se for depois do onboarding. */
export function previousWorkday(now: Date): Date | null {
  const p = getProfile();
  if (!p?.onboardedAt) return null;
  const since = new Date(p.onboardedAt);
  for (let i = 1; i <= 7; i++) {
    const d = addDays(now, -i);
    if (d < new Date(since.getFullYear(), since.getMonth(), since.getDate() + 1)) return null;
    if (isScheduledWorkday(d)) return d;
  }
  return null;
}

/** Um dia útil ficou vazio: nenhum minuto registrado, nenhum foco e nenhum status. */
export function wasEmpty(d: Date): boolean {
  if (dayStatus(dayKey(d))) return false;
  const st = statsFor(d);
  return st.workedMin === 0 && st.focusSessionsCompleted === 0;
}

let asking = false;

async function askAboutYesterday(now = new Date()): Promise<void> {
  if (asking || focusState()) return;
  const d = previousWorkday(now);
  if (!d || !wasEmpty(d)) return;
  const key = dayKey(d);
  if (getKV<boolean>(`absence:asked:${key}`, false)) return;
  setKV(`absence:asked:${key}`, true);
  await askAbout(d, now, false);
}

/** O card em si. `dryRun` (painel de debug) mostra sem gravar nada. */
async function askAbout(d: Date, now: Date, dryRun: boolean): Promise<void> {
  const key = dayKey(d);
  const setDay = dryRun ? (): null => null : saveDay;
  asking = true;
  try {
    const yesterday = dayKey(addDays(now, -1)) === key;
    const answer = await showCard(
      {
        kind: 'info',
        glow: 'none',
        mascot: 'looking',
        label: 'dia sem registro',
        title: yesterday ? 'Ontem não te vi. Foi folga?' : `Não te vi em ${br(key)}. Foi folga?`,
        buttons: [
          { id: 'forgot', label: 'Esqueci de abrir o Pipo', variant: 'tertiary' },
          { id: 'offline', label: 'Trabalhei fora do PC', variant: 'secondary' },
          { id: 'sick', label: 'Doente', variant: 'secondary' },
          { id: 'off', label: 'Folga', kbd: 'Y', variant: 'primary' },
        ],
      },
      { timeoutMs: 10 * 60_000 },
    );
    if (answer === 'off' || answer === 'sick') setDay(key, answer, { source: 'ask' });
    else if (answer === 'forgot') setDay(key, 'no_record', { note: 'esqueci de abrir', source: 'ask' });
    else if (answer === 'offline') {
      const goal = goalForDate(getProfile(), d) || 480;
      const h = await showCard(
        {
          kind: 'info',
          glow: 'none',
          mascot: 'happy',
          label: 'trabalho fora do PC',
          title: 'Mais ou menos quanto tempo?',
          buttons: [
            { id: '120', label: '2h', variant: 'secondary' },
            { id: '240', label: '4h', variant: 'secondary' },
            { id: String(goal), label: 'O dia todo', kbd: 'Y', variant: 'primary' },
          ],
        },
        { timeoutMs: 5 * 60_000, timeoutValue: String(goal) },
      );
      setDay(key, 'offline_work', { minutes: Number(h) || goal, source: 'ask' });
    } else setDay(key, 'no_record', { source: 'ask' });
    if (!dryRun) dayChanged();
  } finally {
    asking = false;
  }
}

/** 3 dias antes das férias: mostra o que vence no período. */
async function vacationHeadsUp(now = new Date()): Promise<void> {
  const today = dayKey(now);
  const v = nextVacation(today);
  if (!v) return;
  const daysLeft = Math.round((parseKey(v.start).getTime() - parseKey(today).getTime()) / 86_400_000);
  if (daysLeft < 1 || daysLeft > 3 || getKV<boolean>(`vacation:headsup:${v.start}`, false)) return;
  setKV(`vacation:headsup:${v.start}`, true);
  const endExclusive = addDays(parseKey(v.end), 1).toISOString();
  const due = listTasks('open').filter((t) => (t.dueAt && t.dueAt < endExclusive) || t.isToday);
  const list = due.slice(0, 3).map((t) => `• ${t.title}`).join('\n');
  const answer = await showCard({
    kind: 'info',
    glow: 'attention',
    mascot: 'happy',
    label: daysLeft === 1 ? 'férias amanhã' : `férias em ${daysLeft} dias`,
    title: `Férias de ${br(v.start)} a ${br(v.end)} 🌴`,
    body: due.length ? `Vence antes de você voltar:\n${list}${due.length > 3 ? `\n… e mais ${due.length - 3}` : ''}` : 'Nada vencendo no período. Pode descansar tranquilo.',
    buttons: [
      { id: 'ok', label: 'Beleza', kbd: 'N', variant: 'secondary' },
      ...(due.length ? [{ id: 'tasks', label: 'Ver tarefas', kbd: 'Y' as const, variant: 'primary' as const }] : []),
    ],
    autoDismissMs: due.length ? undefined : 10_000,
  });
  if (answer === 'tasks') emit('ui:navigate', { tab: 'tasks', expand: true });
}

/** Ganchos para o card "enquanto você estava fora" (os Pipos entram na Fase 21). */
export const awayHooks: Array<(from: string, to: string) => string | null> = [];

/** Primeiro dia depois das férias: o que aconteceu e o que vence esta semana. */
async function backFromVacation(now = new Date()): Promise<void> {
  const today = dayKey(now);
  if (isAbsent(today)) return;
  // Procura férias que terminaram nos últimos 4 dias (fim de semana no meio).
  let lastVacationDay: string | null = null;
  for (let i = 1; i <= 4; i++) {
    const k = dayKey(addDays(now, -i));
    if (storedDay(k)?.kind === 'vacation') {
      lastVacationDay = k;
      break;
    }
  }
  if (!lastVacationDay) return;
  const start = vacationStart(lastVacationDay);
  if (getKV<boolean>(`vacation:back:${start}`, false)) return;
  setKV(`vacation:back:${start}`, true);
  const weekEnd = addDays(now, 7).toISOString();
  const overdue = listTasks('overdue');
  const week = listTasks('open').filter((t) => t.dueAt && t.dueAt >= now.toISOString() && t.dueAt < weekEnd);
  const lines = [
    overdue.length ? `${overdue.length} tarefa${overdue.length > 1 ? 's' : ''} atrasada${overdue.length > 1 ? 's' : ''}` : null,
    week.length ? `${week.length} vence${week.length > 1 ? 'm' : ''} esta semana: ${week.slice(0, 2).map((t) => t.title).join(', ')}${week.length > 2 ? '…' : ''}` : null,
    ...awayHooks.map((h) => h(start, lastVacationDay as string)),
  ].filter(Boolean);
  const answer = await showCard({
    kind: 'info',
    glow: 'done',
    mascot: 'celebrating',
    label: 'enquanto você estava fora',
    title: 'Bem-vindo de volta! ☀️',
    body: lines.length ? lines.join('\n') : 'Tudo tranquilo por aqui. Bora com calma?',
    buttons: [
      { id: 'ok', label: 'Valeu', kbd: 'N', variant: 'secondary' },
      { id: 'plan', label: 'Planejar o dia', kbd: 'Y', variant: 'primary' },
    ],
  });
  if (answer === 'plan') emit('chat:send', { text: 'Planejar meu dia' });
}

/** Trabalhou 3 fins de semana seguidos: comenta uma vez (no máximo 1x por mês). */
async function weekendPattern(now = new Date()): Promise<void> {
  if (now.getDay() !== 1) return;
  const last = getKV<string | null>('weekendNote:last', null);
  if (last && now.getTime() - Date.parse(last) < 30 * 86_400_000) return;
  for (let w = 0; w < 3; w++) {
    const sat = addDays(now, -2 - 7 * w);
    const sun = addDays(now, -1 - 7 * w);
    const min = [sat, sun].filter((d) => !isScheduledWorkday(d)).reduce((acc, d) => acc + statsFor(d).workedMin, 0);
    if (min < 60) return;
  }
  setKV('weekendNote:last', now.toISOString());
  await showCard({
    kind: 'info',
    glow: 'none',
    mascot: 'sad',
    label: 'fins de semana',
    title: 'Três fins de semana seguidos trabalhando.',
    body: 'Tá tudo bem? Que tal proteger o próximo? Eu cuido de lembrar.',
    buttons: [{ id: 'ok', label: 'Vou tentar', kbd: 'Y', variant: 'primary' }],
    autoDismissMs: 15_000,
  });
}

export function registerDays(): void {
  providers.extra = ((prev) => () => ({ ...prev(), today: dayStatus(dayKey(new Date())) }))(providers.extra);

  handle('days:list', (start, end) => {
    const stored = listDays(start, end);
    const prefs = holidayPrefs();
    const years = new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))]);
    const holidays: DayStatus[] = [...years]
      .flatMap((y) => holidaysFor(y, prefs))
      .filter((h) => h.date >= start && h.date <= end && !stored.some((s) => s.date === h.date))
      .map((h) => ({ date: h.date, kind: 'holiday' as DayKind, minutes: null, note: h.name, source: 'holiday' }));
    return [...stored, ...holidays].sort((a, b) => a.date.localeCompare(b.date));
  });
  debugHooks.absence = () => askAbout(addDays(new Date(), -1), new Date(), true);
  debugHooks.vacationBack = async () => {
    const vac = storedDay(dayKey(addDays(new Date(), -1)));
    if (vac?.kind !== 'vacation') saveDay(dayKey(addDays(new Date(), -1)), 'vacation', { note: 'simulação' });
    await backFromVacation();
    if (vac?.kind !== 'vacation') clearDay(dayKey(addDays(new Date(), -1)));
  };

  handle('days:set', (date, kind, opts) => {
    const r = saveDay(date, kind, { ...opts, source: 'user' });
    dayChanged();
    return r;
  });
  handle('days:clear', (date) => {
    clearDay(date);
    dayChanged();
  });
  handle('days:setRange', (start, end, kind, note) => {
    const n = setRange(start, end, kind, note ?? null);
    dayChanged();
    return n;
  });
  handle('days:clearRange', (start, end) => {
    const n = clearRange(start, end);
    dayChanged();
    return n;
  });
  handle('days:holidayPrefs', () => holidayPrefs());
  handle('days:setHolidayPrefs', (p) => {
    const r = setHolidayPrefs(p);
    dayChanged();
    return r;
  });

  every('days', 30 * 60_000, async () => {
    // A primeira rodada é a da abertura (abaixo), depois da entrada do mascote.
    if (process.uptime() < 25) return;
    await askAboutYesterday();
    await vacationHeadsUp();
    await backFromVacation();
    await weekendPattern();
  });
  // Na abertura, espera a entrada do mascote e o card de abrir o dia.
  setTimeout(() => {
    void (async () => {
      await backFromVacation();
      await askAboutYesterday();
      await vacationHeadsUp();
      await weekendPattern();
    })().catch((e) => console.warn('[dias] falhou:', e));
  }, 20_000);
  // Virada do dia: o pijama aparece/some sozinho.
  let lastKey = dayKey(new Date());
  every('dayTurn', 60_000, () => {
    const k = dayKey(new Date());
    if (k !== lastKey) {
      lastKey = k;
      dayChanged();
    }
  });
}
