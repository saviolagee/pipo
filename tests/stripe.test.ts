import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: { handle: () => undefined }, safeStorage: {} }));
const { summarizeIncome } = await import('../src/main/integrations/stripe');

const at = (y: number, m: number, d: number, h = 12): number => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);
const tx = (id: string, amount: number, created: number, type = 'charge', currency = 'brl') => ({ id, amount, net: amount, currency, type, created, description: null });

describe('Stripe', () => {
  it('soma o que entrou hoje, na semana e no mês (reembolso desconta, taxas e saques não contam)', () => {
    const now = new Date(2026, 9, 7, 15); // qua 07/10
    const r = summarizeIncome(
      [
        tx('a', 30000, at(2026, 10, 7, 9)),
        tx('b', 12050, at(2026, 10, 7, 14)),
        tx('c', -5000, at(2026, 10, 7, 14), 'refund'),
        tx('d', 20000, at(2026, 10, 5)),
        tx('e', 10000, at(2026, 10, 2)),
        tx('f', -999999, at(2026, 10, 6), 'payout'),
        tx('g', -1500, at(2026, 10, 6), 'stripe_fee'),
        tx('h', 5000, at(2026, 10, 7), 'charge', 'usd'),
      ],
      now,
    );
    expect(r.currency).toBe('BRL');
    expect(r.today).toBe(370.5);
    expect(r.week).toBe(570.5);
    expect(r.month).toBe(670.5);
    expect(r.paymentsToday).toBe(2);
    expect(r.last?.id).toBe('b');
  });
});
