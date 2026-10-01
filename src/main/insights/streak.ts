// Sequência de dias batendo a meta e acessórios desbloqueáveis (seção 6.5).
import { STREAK_UNLOCKS } from '@shared/config';
import type { StreakInfo, UnlockableAccessory, Weekday } from '@shared/types';
import { emit } from '../bus';
import { showCard } from '../cards';
import { db } from '../db';
import { getProfile } from '../db/repos/profile';
import { focusMinutes, statsFor } from '../stats';
import { addDays, dayKey, dayRange } from '../time';

export interface DayResult {
  date: string;
  workday: boolean;
  qualifies: boolean;
}

/** Um dia conta se teve ≥ 80% das horas-meta e ≥ 1 foco completo. */
export function qualifies(workedMin: number, goalMin: number, focusCompleted: number): boolean {
  return goalMin > 0 && workedMin >= goalMin * 0.8 && focusCompleted >= 1;
}

/**
 * Sequência atual a partir de dias do mais recente para o mais antigo. Dias de folga não quebram
 * nem contam; hoje ainda em aberto não quebra a sequência.
 */
export function currentStreak(daysNewestFirst: DayResult[], todayKey: string): number {
  let n = 0;
  for (const d of daysNewestFirst) {
    if (!d.workday) continue;
    if (d.qualifies) n++;
    else if (d.date === todayKey) continue;
    else break;
  }
  return n;
}

export function unlocksFor(days: number): UnlockableAccessory[] {
  return STREAK_UNLOCKS.filter((u) => days >= u.days).map((u) => u.accessory);
}

const LABEL: Record<UnlockableAccessory, string> = { scarf: 'cachecol', cool_glasses: 'óculos estilosos', hat: 'chapéu', crown: 'coroa', cape: 'capa' };

interface Row {
  current_days: number;
  best_days: number;
  unlocked_json: string;
  equipped_json: string;
}

export function getStreak(): StreakInfo {
  const r = db().get<Row>('SELECT * FROM streaks WHERE id = 1');
  if (!r) return { currentDays: 0, bestDays: 0, unlocked: [], equipped: [] };
  return { currentDays: r.current_days, bestDays: r.best_days, unlocked: JSON.parse(r.unlocked_json) as UnlockableAccessory[], equipped: JSON.parse(r.equipped_json) as UnlockableAccessory[] };
}

function save(s: StreakInfo): void {
  db().run(
    `INSERT INTO streaks (id, current_days, best_days, unlocked_json, equipped_json, last_day) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET current_days = excluded.current_days, best_days = excluded.best_days, unlocked_json = excluded.unlocked_json, equipped_json = excluded.equipped_json, last_day = excluded.last_day`,
    s.currentDays,
    s.bestDays,
    JSON.stringify(s.unlocked),
    JSON.stringify(s.equipped),
    dayKey(new Date()),
  );
}

export function equip(equipped: UnlockableAccessory[]): StreakInfo {
  const s = getStreak();
  const next = { ...s, equipped: equipped.filter((a) => s.unlocked.includes(a)) };
  save(next);
  emit('streak:changed', next);
  return next;
}

/** Recalcula a partir do histórico (até 90 dias) e comemora desbloqueios novos (não gasta orçamento). */
export async function refreshStreak(now = new Date()): Promise<StreakInfo> {
  const p = getProfile();
  const days: DayResult[] = [];
  for (let i = 0; i < 90; i++) {
    const d = addDays(now, -i);
    const workday = !!p && p.workDays.includes(d.getDay() as Weekday);
    const { start, end } = dayRange(d);
    const st = statsFor(d);
    days.push({ date: dayKey(d), workday, qualifies: workday && qualifies(st.workedMin, st.goalMin, focusMinutes(start, end).completed) });
  }
  const prev = getStreak();
  const cur = currentStreak(days, dayKey(now));
  const unlocked = [...new Set([...prev.unlocked, ...unlocksFor(cur)])];
  const fresh = unlocked.filter((a) => !prev.unlocked.includes(a));
  // Acessório novo já vem equipado (dá para tirar em Configurações).
  const next: StreakInfo = { currentDays: cur, bestDays: Math.max(prev.bestDays, cur), unlocked, equipped: [...new Set([...prev.equipped, ...fresh])] };
  save(next);
  emit('streak:changed', next);
  for (const a of fresh) {
    emit('mascot:react', { state: 'celebrating', ms: 2600 });
    void showCard({
      kind: 'unlock',
      glow: 'done',
      mascot: 'celebrating',
      label: `${cur} dias seguidos`,
      title: `Ganhei um ${LABEL[a]}! 🎉`,
      body: 'Obrigado por bater a meta comigo.',
      buttons: [{ id: 'ok', label: 'Eba!', kbd: 'Y', variant: 'primary' }],
      autoDismissMs: 8000,
    });
  }
  return next;
}
