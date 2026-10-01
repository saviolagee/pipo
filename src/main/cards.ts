// Cards de atenção/concluído mostrados no notch. O main aguarda a resposta (Y/N/botão) do renderer.
import { randomUUID } from 'node:crypto';
import type { Card } from '@shared/types';
import { emit } from './bus';
import { handle } from './ipc';

interface Pending {
  resolve: (buttonId: string) => void;
  timer: NodeJS.Timeout | null;
}

const pending = new Map<string, Pending>();

export type CardInput = Omit<Card, 'id'> & { id?: string };

/**
 * Mostra um card e resolve com o id do botão escolhido.
 * Com `timeoutMs`, resolve com `timeoutValue` (padrão 'timeout') e remove o card.
 */
export function showCard(input: CardInput, opts: { timeoutMs?: number; timeoutValue?: string } = {}): Promise<string> {
  const id = input.id ?? randomUUID();
  const card: Card = { ...input, id };
  emit('card:show', card);
  return new Promise((resolve) => {
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          pending.delete(id);
          emit('card:dismiss', { id });
          resolve(opts.timeoutValue ?? 'timeout');
        }, opts.timeoutMs)
      : null;
    pending.set(id, { resolve, timer });
  });
}

export function dismissCard(id: string, value = 'dismissed'): void {
  const p = pending.get(id);
  if (p) {
    if (p.timer) clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(value);
  }
  emit('card:dismiss', { id });
}

/** Respostas com conteúdo (aprovação em lote): id do card → itens decididos. */
const payloads = new Map<string, unknown>();

export function takeCardPayload<T>(id: string): T | undefined {
  const v = payloads.get(id) as T | undefined;
  payloads.delete(id);
  return v;
}

export function registerCardsIpc(): void {
  handle('cards:respondBatch', (id, decisions) => {
    const p = pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    pending.delete(id);
    payloads.set(id, decisions);
    p.resolve(decisions.some((d) => d.keep) ? 'yes' : 'no');
  });
  handle('cards:respond', (id, buttonId) => {
    const p = pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(buttonId);
  });
}
