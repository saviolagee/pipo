// Reações ao que o usuário está fazendo (seções 9.6, 9.8 e o guardião de distração do foco).
import { pickNextTask } from '@shared/suggest';
import type { CurrentActivity, Task } from '@shared/types';
import { activityListeners } from '../activity/tracker';
import { agentAvailable } from '../agent/service';
import { emit } from '../bus';
import { showCard } from '../cards';
import { getProfile } from '../db/repos/profile';
import { getSettings, patchSettings } from '../db/repos/settings';
import { getTask, listTasks, snoozeTask } from '../db/repos/tasks';
import { addDistracted, focusState, startFocus } from '../focus/session';
import { interruptions } from '../interruptions/manager';
import { agentHooks } from '../mcp/tools';
import { dayFlag, every, setDayFlag } from '../scheduler';
import { tasksChanged } from '../tasks/ipc';
import { fmtDue } from '@shared/format';
import { hmToMin, minutesOfDay } from '../time';

const POLL_SEC = 5;

// ---------- Guardião de distração (durante o foco) ----------
let distractedSince: number | null = null;
let distractionItem: string | null = null;
const snoozedUntil = new Map<string, number>();
let guardianOpen = false;

async function onDistraction(a: CurrentActivity | null, item: string | null): Promise<void> {
  const f = focusState();
  const inFocus = !!f && f.phase === 'focus' && !f.paused;
  if (!inFocus || !a || a.category !== 'distraction' || !item) {
    distractedSince = null;
    distractionItem = null;
    return;
  }
  addDistracted(POLL_SEC);
  if (distractionItem !== item) {
    distractionItem = item;
    distractedSince = Date.now();
  }
  const tolerance = getSettings().distractions.toleranceSec * 1000;
  if (guardianOpen || Date.now() - (distractedSince ?? Date.now()) < tolerance) return;
  if ((snoozedUntil.get(item) ?? 0) > Date.now()) return;
  guardianOpen = true;
  const mins = Math.max(1, Math.round((Date.now() - (distractedSince ?? Date.now())) / 60_000));
  try {
    const answer = await interruptions.request({
      type: 'distraction',
      queueable: false,
      fallbackExpression: 'looking',
      card: {
        kind: 'distraction',
        glow: 'attention',
        mascot: 'attention',
        label: 'distração no foco',
        subject: `${item} há ${mins} min`,
        buttons: [
          { id: 'more', label: 'Mais 5 min', kbd: 'N', variant: 'secondary' },
          { id: 'back', label: 'Voltar ao foco', kbd: 'Y', variant: 'primary' },
          { id: 'allow', label: 'Sempre permitir', variant: 'tertiary' },
        ],
      },
    });
    if (answer === 'more') snoozedUntil.set(item, Date.now() + 5 * 60_000);
    else if (answer === 'allow') {
      const s = getSettings();
      patchSettings({ distractions: { ...s.distractions, allowed: [...new Set([...s.distractions.allowed, item])] } });
    } else snoozedUntil.set(item, Date.now() + 2 * 60_000);
  } finally {
    guardianOpen = false;
    distractedSince = Date.now();
  }
}

// ---------- Reunião ----------
let meeting = false;
let lastMeetingSeen = 0;
/** Agenda (Fase 10) informa se há um evento em andamento. */
export const meetingHooks: { calendarMeetingNow: (() => boolean) | null } = { calendarMeetingNow: null };

function setMeeting(on: boolean): void {
  if (on === meeting) return;
  meeting = on;
  interruptions.setMeeting(on);
  emit('meeting:active', on);
  if (!on) void meetingFollowup();
}

async function meetingFollowup(): Promise<void> {
  if (!getSettings().reactions.meeting) return;
  // Não gasta orçamento: é a continuação da reunião que o usuário teve.
  const answer = await showCard({
    kind: 'meeting_followup',
    glow: 'none',
    mascot: 'happy',
    label: 'reunião terminou',
    title: 'Anoto os próximos passos?',
    buttons: [
      { id: 'no', label: 'Agora não', kbd: 'N', variant: 'secondary' },
      { id: 'yes', label: 'Anotar', kbd: 'Y', variant: 'primary' },
    ],
    autoDismissMs: 60_000,
  });
  if (answer === 'yes') emit('ui:navigate', { tab: 'add', expand: true, capture: true, voice: true, purpose: 'meeting' });
}

function onMeeting(a: CurrentActivity | null): void {
  if (!getSettings().reactions.meeting) return setMeeting(false);
  const now = Date.now();
  const byActivity = a?.category === 'meeting';
  const byCalendar = meetingHooks.calendarMeetingNow?.() ?? false;
  if (byActivity || byCalendar) {
    lastMeetingSeen = now;
    setMeeting(true);
  } else if (meeting && now - lastMeetingSeen > 60_000) {
    setMeeting(false);
  }
}

// ---------- E-mail longo (Gmail > 30 min) ----------
let gmailSec = 0;
let gmailDay = '';

async function onGmail(a: CurrentActivity | null): Promise<void> {
  const today = new Date().toDateString();
  if (gmailDay !== today) {
    gmailDay = today;
    gmailSec = 0;
  }
  const isGmail = !!a && (/gmail/i.test(a.title) || /mail\.google\.com/i.test(a.url ?? ''));
  if (!isGmail) return;
  gmailSec += POLL_SEC;
  if (gmailSec < 30 * 60 || dayFlag('emailReaction') || !getSettings().reactions.email) return;
  if (!agentHooks.unreadEmails || !agentAvailable()) return;
  setDayFlag('emailReaction');
  const answer = await interruptions.request({
    type: 'context',
    fallbackExpression: 'looking',
    card: {
      kind: 'context_email',
      glow: 'attention',
      mascot: 'attention',
      label: 'e-mail longo',
      subject: `${Math.round(gmailSec / 60)} min no Gmail`,
      title: 'Quer que eu liste o que falta responder?',
      buttons: [
        { id: 'no', label: 'Agora não', kbd: 'N', variant: 'secondary' },
        { id: 'yes', label: 'Listar o que falta', kbd: 'Y', variant: 'primary' },
      ],
    },
  });
  if (answer === 'yes') emit('chat:send', { text: 'Lista curta do que falta responder no meu e-mail (não lidos), com o que é mais urgente primeiro.' });
}

// ---------- Destravar sozinho (15 min sem foco alternando distrações) ----------
const window15: Array<{ at: number; cat: string }> = [];
let lastUnstuck = 0;

function inWorkHours(): boolean {
  const p = getProfile();
  if (!p) return false;
  const d = new Date();
  if (!p.workDays.includes(d.getDay() as (typeof p.workDays)[number])) return false;
  const m = minutesOfDay(d);
  return m >= hmToMin(p.startTime) && m < hmToMin(p.endTime);
}

/** Sinal de procrastinação: maioria do tempo em distrações e alternando. Exportado para testes. */
export function looksStuck(samples: Array<{ at: number; cat: string }>, now: number): boolean {
  const recent = samples.filter((s) => now - s.at <= 15 * 60_000);
  if (recent.length < (14 * 60) / POLL_SEC) return false;
  const distracted = recent.filter((s) => s.cat === 'distraction').length / recent.length;
  let switches = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i].cat !== recent[i - 1].cat) switches++;
  return distracted >= 0.5 && switches >= 3;
}

async function onUnstuck(a: CurrentActivity | null): Promise<void> {
  const now = Date.now();
  window15.push({ at: now, cat: a?.category ?? 'none' });
  while (window15.length && now - window15[0].at > 15 * 60_000) window15.shift();
  if (focusState() || !inWorkHours() || !getSettings().reactions.unstuck) return;
  if (now - lastUnstuck < 60 * 60_000 || !looksStuck(window15, now)) return;
  lastUnstuck = now;
  const task = pickNextTask(listTasks('open'), new Date(), getProfile()?.energyPeak ?? 'varies', true);
  if (!task) return;
  const step = `Abre “${task.title}” e faz só o primeiro passo`;
  const answer = await interruptions.request({
    type: 'unstuck',
    fallbackExpression: 'sad',
    card: {
      kind: 'unstuck',
      glow: 'attention',
      mascot: 'attention',
      label: 'destravar',
      title: 'Bora só isso?',
      subject: task.subtasks.find((s) => !s.done)?.title ?? step,
      buttons: [
        { id: 'no', label: 'Agora não', kbd: 'N', variant: 'secondary' },
        { id: 'go', label: 'Bora', kbd: 'Y', variant: 'primary' },
      ],
    },
  });
  if (answer === 'go') await startFocus({ taskId: task.id, minutes: 5, microStep: task.subtasks.find((s) => !s.done)?.title ?? step });
}

// ---------- Prazo vencendo ----------
async function checkDeadlines(): Promise<void> {
  const now = Date.now();
  const f = focusState();
  const due = listTasks('open').filter((t) => t.dueAt && Date.parse(t.dueAt) > now && Date.parse(t.dueAt) - now < 3 * 3_600_000 && t.id !== f?.taskId && t.status !== 'doing');
  for (const t of due) {
    if (dayFlag(`deadline:${t.id}`)) continue;
    setDayFlag(`deadline:${t.id}`);
    void deadlineCard(t);
    break;
  }
}

async function deadlineCard(t: Task): Promise<void> {
  const answer = await interruptions.request({
    type: 'deadline',
    fallbackExpression: 'attention',
    stillRelevant: () => {
      const cur = getTask(t.id);
      return !!cur && cur.status !== 'done' && !!cur.dueAt && Date.parse(cur.dueAt) > Date.now();
    },
    card: {
      kind: 'deadline',
      glow: 'attention',
      mascot: 'attention',
      label: 'prazo vencendo',
      subject: `${t.title} · vence ${fmtDue(t.dueAt as string)}`,
      buttons: [
        { id: 'tomorrow', label: 'Amanhã', kbd: 'N', variant: 'secondary' },
        { id: 'start', label: 'Começar agora', kbd: 'Y', variant: 'primary' },
      ],
    },
  });
  if (answer === 'tomorrow') {
    snoozeTask(t.id);
    tasksChanged();
  } else if (answer === 'start') await startFocus({ taskId: t.id });
}

export function registerContextReactions(): void {
  activityListeners.push((a, item) => {
    void onDistraction(a, item);
    onMeeting(a);
    void onGmail(a);
    void onUnstuck(a);
  });
  every('interruptions', 30_000, () => interruptions.tick());
  every('deadlines', 5 * 60_000, checkDeadlines);
  every('meetingCalendar', 30_000, () => onMeeting(null));
}

export function isInMeeting(): boolean {
  return meeting;
}

/** Usado pelo painel de debug. */
export function simulateMeeting(on: boolean): void {
  if (on) lastMeetingSeen = Date.now();
  setMeeting(on);
}
