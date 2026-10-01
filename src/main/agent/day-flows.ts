// Abrir e fechar o dia (seção 9.10). Não gastam orçamento: acontecem no horário que o usuário configurou.
import { ipcMain } from 'electron';
import { emit } from '../bus';
import { showCard } from '../cards';
import { getProfile } from '../db/repos/profile';
import { focusHooks } from '../focus/session';
import { dayFlag, every, setDayFlag } from '../scheduler';
import { hmToMin, minutesOfDay } from '../time';
import { agentAvailable, proposeSubtasks } from './service';

function isWorkday(d = new Date()): boolean {
  const p = getProfile();
  return !!p && p.workDays.includes(d.getDay() as (typeof p.workDays)[number]);
}

async function openDay(): Promise<void> {
  const p = getProfile();
  if (!p?.onboardedAt || !isWorkday() || dayFlag('openDay')) return;
  const now = minutesOfDay(new Date());
  if (now < hmToMin(p.startTime) || now > hmToMin(p.endTime)) return;
  setDayFlag('openDay');
  const answer = await showCard({
    kind: 'plan_day',
    glow: 'none',
    mascot: 'happy',
    label: 'bom dia',
    title: `Bom dia, ${p.name}! Bora planejar?`,
    buttons: [
      { id: 'later', label: 'Agora não', kbd: 'N', variant: 'secondary' },
      { id: 'plan', label: 'Planejar', kbd: 'Y', variant: 'primary' },
    ],
  });
  if (answer === 'plan') {
    if (agentAvailable()) emit('chat:send', { text: 'Planejar meu dia' });
    else emit('ui:navigate', { tab: 'tasks', expand: true });
  }
}

async function closeDayCheck(): Promise<void> {
  const p = getProfile();
  if (!p?.onboardedAt || !isWorkday() || dayFlag('closeDay')) return;
  const now = minutesOfDay(new Date());
  const end = hmToMin(p.endTime);
  if (now < end || now > end + 120) return;
  setDayFlag('closeDay');
  const answer = await showCard({
    kind: 'close_day',
    glow: 'none',
    mascot: 'sleepy',
    label: 'fim do expediente',
    title: 'Bora fechar o dia?',
    buttons: [
      { id: 'later', label: 'Depois', kbd: 'N', variant: 'secondary' },
      { id: 'close', label: 'Fechar o dia', kbd: 'Y', variant: 'primary' },
    ],
  });
  if (answer === 'close') emit('ui:navigate', { tab: 'review', expand: true });
}

export function registerDayFlows(): void {
  focusHooks.proposeSubtasks = proposeSubtasks;
  // Primeira interação do dia (o notch abriu) depois do horário de início.
  ipcMain.on('ui:expandedChanged', (_e, expanded: boolean) => {
    if (expanded) void openDay();
  });
  every('closeDay', 60_000, closeDayCheck);
}
