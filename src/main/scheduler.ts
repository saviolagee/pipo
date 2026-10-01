// Tarefas periódicas: atualização das estatísticas, meta do dia e (nas fases seguintes) humor, agenda e padrões.
import { emit } from './bus';
import { getKV, setKV } from './db/repos/settings';
import { interruptions } from './interruptions/manager';
import { todayStats } from './stats';
import { dayKey } from './time';
import { fmtDuration } from './focus/format';

type Job = { name: string; everyMs: number; run: () => void | Promise<void>; last: number };
const jobs: Job[] = [];
let timer: NodeJS.Timeout | null = null;

export function every(name: string, everyMs: number, run: () => void | Promise<void>): void {
  jobs.push({ name, everyMs, run, last: 0 });
}

/** Marcadores "já fiz isso hoje" (cards que aparecem no máximo 1x por dia). */
export function dayFlag(key: string): boolean {
  const flags = getKV<Record<string, boolean>>(`flags:${dayKey(new Date())}`, {});
  return !!flags[key];
}

export function setDayFlag(key: string): void {
  const k = `flags:${dayKey(new Date())}`;
  setKV(k, { ...getKV<Record<string, boolean>>(k, {}), [key]: true });
}

async function checkGoal(): Promise<void> {
  const s = todayStats();
  emit('stats:changed', s);
  if (s.goalMin <= 0) return;
  if (s.workedMin >= s.goalMin && !dayFlag('goalReached')) {
    setDayFlag('goalReached');
    emit('mascot:react', { state: 'celebrating', ms: 2600 });
    const answer = await interruptions.request({
      type: 'goal',
      card: {
        kind: 'goal_reached',
        glow: 'done',
        mascot: 'celebrating',
        label: 'meta batida',
        subject: `${fmtDuration(s.workedMin * 60)} feitas!`,
        buttons: [
          { id: 'more', label: 'Mais um pouco', kbd: 'N', variant: 'secondary' },
          { id: 'close', label: 'Fechar o dia', kbd: 'Y', variant: 'primary' },
        ],
      },
    });
    if (answer === 'close') emit('ui:navigate', { tab: 'review', expand: true });
  } else if (s.workedMin >= s.goalMin * 1.25 && !dayFlag('goalExceeded')) {
    setDayFlag('goalExceeded');
    const answer = await interruptions.request({
      type: 'goal',
      fallbackExpression: 'tired',
      card: {
        kind: 'goal_exceeded',
        glow: 'attention',
        mascot: 'tired',
        label: 'passou da meta',
        subject: `Já são ${fmtDuration(s.workedMin * 60)}`,
        buttons: [
          { id: 'more', label: 'Mais um pouco', kbd: 'N', variant: 'secondary' },
          { id: 'close', label: 'Fechar o dia', kbd: 'Y', variant: 'primary' },
        ],
      },
    });
    if (answer === 'close') emit('ui:navigate', { tab: 'review', expand: true });
  }
}

export function startScheduler(): void {
  every('goal', 60_000, checkGoal);
  timer = setInterval(() => {
    const now = Date.now();
    for (const j of jobs) {
      if (now - j.last >= j.everyMs) {
        j.last = now;
        Promise.resolve(j.run()).catch((e) => console.warn(`[agenda] ${j.name} falhou:`, e));
      }
    }
  }, 5_000);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
}
