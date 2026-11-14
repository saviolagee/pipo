// Avisos das atividades: o que passou para frente (ações da trilha e tarefas que venceram) e
// lembretes ao longo do expediente para fazer as do dia. Notificação do sistema: aparece mesmo com o
// Pipo recolhido ou com outro app na frente. No máximo três por dia (começo, tarde e fim).
import { nativeImage, Notification } from 'electron';
import { dueSlot, reminderText, SLOTS, type PushedItem, type ReminderText, type Slot, type TodayItem } from '@shared/reminders';
import { summarize } from '@shared/trail';
import { emit, getFullWindow } from './bus';
import { openAppWindow } from './app-window';
import { isAbsent } from './db/repos/days';
import { listGoals, type PushedAction } from './db/repos/goals';
import { getProfile } from './db/repos/profile';
import { getKV, getSettings, setKV } from './db/repos/settings';
import { listTasks } from './db/repos/tasks';
import { db } from './db';
import { renderFace } from './icons';
import { interruptions } from './interruptions/manager';
import { dayFlag, every, setDayFlag } from './scheduler';
import { dayKey, dayRange, hmToMin, minutesOfDay } from './time';
import { showNotch } from './window';

const PUSHED_KEY = 'reminders:pushed';
const SINCE_KEY = 'reminders:since';

/** Guarda as ações da trilha que passaram para frente até o próximo aviso. */
export function recordPushed(list: PushedAction[]): void {
  if (!list.length) return;
  const cur = getKV<PushedAction[]>(PUSHED_KEY, []);
  // A mesma ação empurrada de novo fica uma vez só, com o destino mais novo.
  const next = [...cur.filter((x) => !list.some((y) => y.goalId === x.goalId && y.title === x.title)), ...list].slice(-30);
  setKV(PUSHED_KEY, next);
}

/** O que falta fazer hoje: a ação do dia de cada plano e as tarefas de Hoje. */
export function todayItems(now = new Date()): TodayItem[] {
  const today = dayKey(now);
  const actions = listGoals()
    .filter((g) => g.status === 'active')
    .flatMap((g) => {
      const cur = summarize(g, today).current;
      return cur && cur.day <= today ? [{ title: cur.title, kind: 'trilha' as const }] : [];
    });
  const tasks = listTasks('today', now).map((t) => ({ title: t.title, kind: 'tarefa' as const }));
  return [...actions, ...tasks];
}

/** Tarefas que venceram desde o último aviso e continuam por fazer. */
function overdueSince(since: string, now: Date): PushedItem[] {
  const today = dayKey(now);
  return db()
    .all<{ title: string; due_at: string }>("SELECT title, due_at FROM tasks WHERE status != 'done' AND due_at IS NOT NULL AND due_at >= ? AND due_at < ? ORDER BY due_at", since, dayRange(now).start)
    .map((t) => ({ kind: 'tarefa' as const, title: t.title, from: dayKey(new Date(t.due_at)), to: today }));
}

const shown = new Set<Notification>();

function open(): void {
  if (getFullWindow()) return openAppWindow('home');
  showNotch(true);
  emit('ui:navigate', { tab: 'home', expand: true });
}

function show(text: ReminderText): void {
  emit('mascot:say', { text: text.title, ms: 8000 });
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: text.title, body: text.body, icon: nativeImage.createFromBuffer(renderFace({ size: 128, style: 'color', background: [24, 24, 28] })) });
  // Guarda a referência até a notificação sair (senão o clique se perde).
  shown.add(n);
  n.on('click', () => {
    shown.delete(n);
    open();
  });
  n.on('close', () => shown.delete(n));
  n.show();
}

/**
 * Confere se é hora de algum lembrete e, se for, mostra. `force` (painel de debug) ignora o horário,
 * a folga e a reunião, e não conta como o lembrete do dia.
 */
export function remindNow(now = new Date(), force = false): ReminderText | null {
  const s = getSettings();
  const r = s.reactions;
  if (!r.reminders && !r.pushed) return null;
  const p = getProfile();
  if (!p) return null;
  const today = dayKey(now);
  if (!force) {
    if (s.paused || !p.workDays.includes(now.getDay() as (typeof p.workDays)[number]) || isAbsent(today)) return null;
    // Em reunião espera: o lembrete sai no próximo minuto livre.
    if (interruptions.inMeeting()) return null;
  }
  const sent = SLOTS.filter((x) => dayFlag(`reminder:${x}`));
  const slot: Slot | null = force ? 'manha' : dueSlot(minutesOfDay(now), hmToMin(p.startTime), hmToMin(p.endTime), sent);
  if (!slot) return null;
  if (!force) setDayFlag(`reminder:${slot}`);
  const since = getKV<string | null>(SINCE_KEY, null) ?? new Date(now.getTime() - 86_400_000).toISOString();
  const trail = getKV<PushedAction[]>(PUSHED_KEY, []).map((a): PushedItem => ({ kind: 'trilha', title: a.title, from: a.from, to: a.to, goal: a.goal, end: a.end }));
  const pushed = [...trail, ...overdueSince(since, now)];
  const text = reminderText(slot, todayItems(now), pushed, { remind: r.reminders, pushed: r.pushed, today });
  // O que passou para frente é contado uma vez: no aviso que saiu (ou some, se o aviso está desligado).
  if (text || !r.pushed) {
    setKV(PUSHED_KEY, []);
    setKV(SINCE_KEY, dayRange(now).start);
  }
  if (text) show(text);
  return text;
}

export function registerReminders(): void {
  every('reminders', 60_000, () => void remindNow());
}
