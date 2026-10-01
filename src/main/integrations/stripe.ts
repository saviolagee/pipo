// Stripe (só leitura): quanto dinheiro está entrando hoje/semana/mês, mostrado na pill.
// Usa uma chave restrita (rk_…) com leitura de Balance transactions, guardada no cofre.
import type { StripeIncome } from '@shared/types';
import { emit } from '../bus';
import { getIntegration, saveIntegration } from '../db/repos/integrations';
import { getKV, setKV } from '../db/repos/settings';
import { registerTools } from '../mcp/tools';

interface BalanceTx {
  id: string;
  amount: number;
  net: number;
  currency: string;
  type: string;
  created: number;
  description: string | null;
}

/** Tipos que contam como dinheiro entrando (reembolsos entram negativos). */
const INCOME_TYPES = new Set(['charge', 'payment', 'refund', 'payment_refund']);

export function stripeKey(): string | null {
  return getIntegration('stripe').tokens?.access_token ?? null;
}

async function stripeGet<T>(path: string, key = stripeKey()): Promise<T> {
  if (!key) throw new Error('Stripe não conectada.');
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${key}` } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      // texto cru
    }
    throw new Error(res.status === 401 ? 'Chave da Stripe inválida.' : res.status === 403 ? 'A chave não tem permissão de leitura em Balance transactions.' : `Stripe ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

/** Transações de saldo desde `since` (até 1000, mais recentes primeiro). */
export async function balanceTransactions(since: Date, key?: string): Promise<BalanceTx[]> {
  const out: BalanceTx[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ limit: '100', 'created[gte]': String(Math.floor(since.getTime() / 1000)) });
    if (after) q.set('starting_after', after);
    const r = await stripeGet<{ data: BalanceTx[]; has_more: boolean }>(`/balance_transactions?${q.toString()}`, key);
    out.push(...r.data);
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Soma o que entrou por período, na moeda principal. Puro: tests/stripe.test.ts. */
export function summarizeIncome(txs: BalanceTx[], now: Date): StripeIncome {
  const today = startOfDay(now).getTime() / 1000;
  // Semana começa na segunda.
  const dow = (now.getDay() + 6) % 7;
  const week = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)).getTime() / 1000;
  const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const income = txs.filter((t) => INCOME_TYPES.has(t.type));
  const byCurrency = new Map<string, number>();
  for (const t of income) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + Math.abs(t.amount));
  const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'brl';
  const sum = (since: number): number => income.filter((t) => t.currency === currency && t.created >= since).reduce((acc, t) => acc + t.amount, 0) / 100;
  const last = income.filter((t) => t.currency === currency && t.amount > 0).sort((a, b) => b.created - a.created)[0];
  return {
    currency: currency.toUpperCase(),
    today: sum(today),
    week: sum(week),
    month: sum(month),
    paymentsToday: income.filter((t) => t.currency === currency && t.amount > 0 && t.created >= today).length,
    last: last ? { amount: last.amount / 100, at: new Date(last.created * 1000).toISOString(), description: last.description, id: last.id } : null,
    updatedAt: now.toISOString(),
  };
}

let current: StripeIncome | null = null;

export function currentIncome(): StripeIncome | null {
  return current;
}

export async function connectStripe(key: string): Promise<string> {
  const k = key.trim();
  if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.test(k)) throw new Error('Cole uma chave da Stripe (de preferência restrita, começa com rk_live_ ou rk_test_).');
  await balanceTransactions(new Date(Date.now() - 86_400_000), k);
  const detail = `${k.startsWith('rk_') ? 'chave restrita' : 'chave secreta'}${k.includes('_test_') ? ' · modo teste' : ''} ••••${k.slice(-4)}`;
  saveIntegration('stripe', { access_token: k, expires_at: Number.MAX_SAFE_INTEGER }, { detail });
  setKV('stripe:lastSeen', null);
  await refreshIncome(true);
  return detail;
}

export function disconnectStripe(): void {
  saveIntegration('stripe', null, {});
  current = null;
  emit('stripe:income', null);
}

/** Atualiza os números; pagamento novo desde a última olhada → comemora (sem card). */
export async function refreshIncome(first = false): Promise<StripeIncome | null> {
  if (!stripeKey()) return null;
  const now = new Date();
  const txs = await balanceTransactions(new Date(now.getFullYear(), now.getMonth(), 1));
  const next = summarizeIncome(txs, now);
  const lastSeen = getKV<string | null>('stripe:lastSeen', null);
  if (next.last && next.last.id !== lastSeen) {
    if (lastSeen && !first) {
      emit('mascot:react', { state: 'celebrating', ms: 2600 });
      emit('stripe:payment', { amount: next.last.amount, currency: next.currency, description: next.last.description });
    }
    setKV('stripe:lastSeen', next.last.id);
  }
  current = next;
  emit('stripe:income', next);
  return next;
}

export function registerStripeTools(): void {
  registerTools([
    {
      name: 'get_revenue',
      modes: ['chat', 'pipo'],
      description: 'Quanto dinheiro entrou na Stripe (hoje, semana, mês), número de pagamentos de hoje e o último pagamento. Só leitura.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        if (!stripeKey()) return { erro: 'Stripe não conectada (Configurações → Integrações).' };
        return (await refreshIncome().catch(() => current)) ?? current;
      },
    },
  ]);
}
