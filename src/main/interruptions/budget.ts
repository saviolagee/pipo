// Regras do orçamento de interrupções (seção 12). Funções puras, testadas em tests/interruptions.test.ts.

export type InterruptionType = 'deadline' | 'distraction' | 'goal' | 'unstuck' | 'context' | 'pipo' | 'pattern';

/** Prioridade: prazo vencendo > distração > meta > destravar > contexto > Pipo colorido > padrão. */
/** Relatório final de um Pipo colorido agendado fica entre contexto e padrão. */
export const PRIORITY: Record<InterruptionType, number> = { deadline: 7, distraction: 6, goal: 5, unstuck: 4, context: 3, pipo: 2, pattern: 1 };

export const MIN_GAP_MS = 20 * 60_000;
export const SILENCE_AFTER_DECLINES = 3;
export const SILENCE_MS = 7 * 24 * 3_600_000;

export interface BudgetState {
  now: number;
  budget: number;
  /** Interrupções mostradas desde o início do dia de trabalho. */
  spentToday: number;
  /** Momento da última interrupção que gastou orçamento. */
  lastShownAt: number | null;
  paused: boolean;
  inMeeting: boolean;
  silencedUntil: Partial<Record<InterruptionType, number>>;
}

export type Decision =
  | { action: 'show' }
  | { action: 'expression'; reason: 'budget' | 'silenced' }
  | { action: 'drop'; reason: 'paused' }
  | { action: 'queue'; reason: 'meeting' | 'gap'; retryAt: number };

export function decide(type: InterruptionType, s: BudgetState): Decision {
  if (s.paused) return { action: 'drop', reason: 'paused' };
  const silenced = s.silencedUntil[type];
  if (silenced && silenced > s.now) return { action: 'expression', reason: 'silenced' };
  if (s.spentToday >= s.budget) return { action: 'expression', reason: 'budget' };
  if (s.inMeeting) return { action: 'queue', reason: 'meeting', retryAt: s.now + 60_000 };
  if (s.lastShownAt !== null && s.now - s.lastShownAt < MIN_GAP_MS) return { action: 'queue', reason: 'gap', retryAt: s.lastShownAt + MIN_GAP_MS };
  return { action: 'show' };
}

/** Recusou o mesmo tipo 3 vezes seguidas? (outcomes mais recentes primeiro) */
export function shouldSilence(recentOutcomesOfType: Array<'accepted' | 'declined' | 'dropped'>): boolean {
  const shown = recentOutcomesOfType.filter((o) => o !== 'dropped');
  return shown.length >= SILENCE_AFTER_DECLINES && shown.slice(0, SILENCE_AFTER_DECLINES).every((o) => o === 'declined');
}

/** Da fila, o pedido de maior prioridade (empate: o mais antigo). */
export function pickNext<T extends { type: InterruptionType; createdAt: number }>(queue: T[]): T | null {
  if (!queue.length) return null;
  return [...queue].sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || a.createdAt - b.createdAt)[0];
}
