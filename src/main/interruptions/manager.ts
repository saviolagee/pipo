// Porta de entrada de toda interrupção que gasta orçamento (seção 12). Implementação completa na Fase 9.
import { db } from '../db';
import { showCard, type CardInput } from '../cards';

export type InterruptionType = 'deadline' | 'distraction' | 'goal' | 'unstuck' | 'context' | 'pattern';

export interface InterruptionRequest {
  type: InterruptionType;
  card: CardInput;
  /** Expressão mostrada quando a interrupção é descartada (orçamento acabou etc.). */
  fallbackExpression?: 'looking' | 'attention' | 'tired' | 'sad';
  timeoutMs?: number;
}

export function logInterruption(type: string, outcome: 'accepted' | 'declined' | 'dropped'): void {
  db().run('INSERT INTO interruptions (type, at, outcome) VALUES (?, ?, ?)', type, new Date().toISOString(), outcome);
}

export const interruptions = {
  /** Retorna o botão escolhido, ou null se a interrupção foi descartada. */
  async request(req: InterruptionRequest): Promise<string | null> {
    const answer = await showCard(req.card, { timeoutMs: req.timeoutMs });
    const primary = req.card.buttons.find((b) => b.variant === 'primary')?.id;
    logInterruption(req.type, answer === primary ? 'accepted' : 'declined');
    return answer;
  },
};
