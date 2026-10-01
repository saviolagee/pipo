// Liga humor, sequência e padrões ao app: jobs periódicos, IPC, card semanal e simulações.
import { WEEKDAYS_LONG } from '@shared/format';
import { providers } from '../bootstrap';
import { bus, emit } from '../bus';
import { getKV, setKV } from '../db/repos/settings';
import { debugHooks } from '../debug';
import { interruptions } from '../interruptions/manager';
import { createBlock } from '../integrations/calendar';
import { googleConnected } from '../integrations/google-auth';
import { handle } from '../ipc';
import { agentHooks } from '../mcp/tools';
import { every } from '../scheduler';
import { addDays, dayRange } from '../time';
import { computeMood, currentMood, refreshMood } from './mood';
import { patterns, weeklySummary } from './patterns';
import { seedFourWeeks } from './seed';
import { equip, getStreak, refreshStreak } from './streak';
import { dayHooks } from '../days/flows';

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7)}`;
}

/** Segunda-feira: no máximo uma sugestão por semana (gasta orçamento, tipo "padrão"). */
async function weeklyPattern(force = false): Promise<boolean> {
  const now = new Date();
  const week = isoWeek(now);
  if (!force && (now.getDay() !== 1 || getKV<string | null>('pattern:week', null) === week)) return false;
  const s = patterns(4)[0];
  setKV('pattern:week', week);
  if (!s) return false;
  const b = s.block;
  const answer = await interruptions.request({
    type: 'pattern',
    fallbackExpression: 'looking',
    card: {
      kind: 'pattern',
      glow: 'attention',
      mascot: 'attention',
      label: 'padrão da semana',
      title: s.text,
      buttons: [
        { id: 'no', label: 'Não', kbd: 'N', variant: 'secondary' },
        { id: 'yes', label: b ? `Bloquear ${WEEKDAYS_LONG[b.weekday].replace('-feira', '')} ${b.hour}h` : 'Boa ideia', kbd: 'Y', variant: 'primary' },
      ],
    },
  });
  if (answer === 'yes' && b) {
    if (!googleConnected()) {
      emit('toast:show', { id: 'pattern-cal', text: 'Conecte a Google Agenda para eu criar o bloco recorrente.', durationMs: 5000 });
      return true;
    }
    const start = new Date();
    start.setDate(start.getDate() + ((b.weekday - start.getDay() + 7) % 7 || 7));
    start.setHours(b.hour, 0, 0, 0);
    const code = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][b.weekday];
    await createBlock({ title: b.title, start: start.toISOString(), end: new Date(start.getTime() + b.durationMin * 60_000).toISOString(), recurrence: `RRULE:FREQ=WEEKLY;BYDAY=${code}` });
    emit('toast:show', { id: 'pattern-ok', text: `Bloqueado: ${b.title} toda ${WEEKDAYS_LONG[b.weekday]} às ${b.hour}h.`, durationMs: 5000 });
  }
  return true;
}

/** Humor de dias passados (para a média de 7 dias depois de simular dados). */
function backfillMood(days: number): void {
  for (let i = days; i >= 1; i--) {
    const end = new Date(dayRange(addDays(new Date(), -i)).end);
    refreshMood(new Date(end.getTime() - 60_000));
  }
}

export function registerInsights(): void {
  const prevExtra = providers.extra;
  providers.extra = () => ({ ...prevExtra(), mood: currentMood(), streak: getStreak() });
  agentHooks.mood = () => {
    const m = currentMood();
    return { mood: m.mood, phrase: m.phrase };
  };
  agentHooks.patterns = (weeks) => patterns(weeks);

  handle('mood:get', () => currentMood());
  handle('streak:get', () => getStreak());
  handle('streak:equip', (eq) => equip(eq));
  handle('stats:weekly', () => weeklySummary());

  // Marcar folga/férias muda metas, médias e sequência na hora.
  dayHooks.changed = () => {
    refreshMood();
    void refreshStreak();
  };
  every('mood', 15 * 60_000, () => void refreshMood());
  every('streak', 15 * 60_000, () => void refreshStreak());
  every('weeklyPattern', 30 * 60_000, () => void weeklyPattern());
  bus.on('task:completed', () => void refreshMood());
  bus.on('focus:completed', () => {
    refreshMood();
    void refreshStreak();
  });

  debugHooks.seed4weeks = async () => {
    const r = seedFourWeeks();
    backfillMood(28);
    refreshMood();
    await refreshStreak();
    emit('toast:show', { id: 'seed', text: `Simulados ${r.days} dias úteis. Humor hoje: ${computeMood().mood}.`, durationMs: 4000 });
  };
  debugHooks.pattern = () => {
    void weeklyPattern(true);
  };
  debugHooks.unlock = async () => {
    await refreshStreak();
  };
}
