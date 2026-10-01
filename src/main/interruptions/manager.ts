// Toda interrupção que gasta orçamento passa por aqui (seção 12): orçamento diário, 20 min de
// intervalo, fila durante reuniões, prioridades e silenciamento após 3 recusas seguidas.
import type { MascotState } from '@shared/types';
import { emit } from '../bus';
import { showCard, type CardInput } from '../cards';
import { db } from '../db';
import { isAbsent } from '../db/repos/days';
import { getProfile } from '../db/repos/profile';
import { getKV, getSettings, setKV } from '../db/repos/settings';
import { dayKey, hmToMin } from '../time';
import { decide, pickNext, shouldSilence, SILENCE_MS, type BudgetState, type InterruptionType } from './budget';

export type { InterruptionType } from './budget';

export interface InterruptionRequest {
  type: InterruptionType;
  card: CardInput;
  /** Expressão mostrada quando a interrupção não pode aparecer (orçamento acabou etc.). */
  fallbackExpression?: MascotState;
  /** Pode esperar na fila (reunião / intervalo mínimo)? Distrações não: ficam velhas. */
  queueable?: boolean;
  /** Na fila: ainda faz sentido mostrar? */
  stillRelevant?: () => boolean;
  timeoutMs?: number;
}

interface Pending {
  req: InterruptionRequest;
  createdAt: number;
  resolve: (answer: string | null) => void;
}

const queue: Pending[] = [];
let inMeeting = false;
let showing = false;

export function logInterruption(type: string, outcome: 'accepted' | 'declined' | 'dropped'): void {
  db().run('INSERT INTO interruptions (type, at, outcome) VALUES (?, ?, ?)', type, new Date().toISOString(), outcome);
}

/** Início do dia de trabalho de hoje (o orçamento zera aqui). */
function workdayStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const p = getProfile();
  if (p) {
    const start = new Date(d.getTime() + hmToMin(p.startTime) * 60_000);
    if (now >= start) return start;
  }
  return d;
}

function silenced(): Partial<Record<InterruptionType, number>> {
  return getKV<Partial<Record<InterruptionType, number>>>('interruptions:silenced', {});
}

export function budgetState(now = Date.now()): BudgetState {
  const since = workdayStart(new Date(now)).toISOString();
  const r = db().get<{ n: number; last: string | null }>("SELECT COUNT(*) AS n, MAX(at) AS last FROM interruptions WHERE outcome != 'dropped' AND at >= ?", since);
  return {
    now,
    budget: getProfile()?.interruptBudget ?? 5,
    spentToday: r?.n ?? 0,
    lastShownAt: r?.last ? Date.parse(r.last) : null,
    // Em folga/férias/feriado o Pipo não interrompe (só reage com expressão).
    paused: getSettings().paused || isAbsent(dayKey(new Date(now))),
    inMeeting,
    silencedUntil: silenced(),
  };
}

function maybeSilence(type: InterruptionType): void {
  const rows = db().all<{ outcome: 'accepted' | 'declined' | 'dropped' }>('SELECT outcome FROM interruptions WHERE type = ? ORDER BY id DESC LIMIT 6', type);
  if (!shouldSilence(rows.map((r) => r.outcome))) return;
  setKV('interruptions:silenced', { ...silenced(), [type]: Date.now() + SILENCE_MS });
  emit('toast:show', { id: `silence:${type}`, text: 'Ok, não pergunto mais isso essa semana.', durationMs: 4000 });
}

async function show(req: InterruptionRequest): Promise<string | null> {
  showing = true;
  try {
    const answer = await showCard(req.card, { timeoutMs: req.timeoutMs });
    const primary = req.card.buttons.find((b) => b.variant === 'primary')?.id;
    if (answer === 'timeout' || answer === 'dismissed') logInterruption(req.type, 'dropped');
    else {
      logInterruption(req.type, answer === primary ? 'accepted' : 'declined');
      if (answer !== primary) maybeSilence(req.type);
    }
    return answer;
  } finally {
    showing = false;
  }
}

export const interruptions = {
  /** Retorna o botão escolhido, ou null se a interrupção virou só expressão / foi descartada. */
  request(req: InterruptionRequest): Promise<string | null> {
    const d = decide(req.type, budgetState());
    if (d.action === 'show' && !showing) return show(req);
    if (d.action === 'drop') {
      logInterruption(req.type, 'dropped');
      return Promise.resolve(null);
    }
    if (d.action === 'expression' || req.queueable === false || (d.action === 'show' && showing)) {
      // Fora do orçamento o Pipo só reage com a expressão, sem expandir nem pedir ação.
      if (req.fallbackExpression) emit('mascot:react', { state: req.fallbackExpression, ms: 4000 });
      logInterruption(req.type, 'dropped');
      return Promise.resolve(null);
    }
    return new Promise((resolve) => queue.push({ req, createdAt: Date.now(), resolve }));
  },

  /** Processa a fila (chamado periodicamente e quando uma reunião termina). */
  async tick(): Promise<void> {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].req.stillRelevant && !queue[i].req.stillRelevant!()) {
        queue[i].resolve(null);
        queue.splice(i, 1);
      }
    }
    const next = pickNext(queue.map((p) => ({ ...p, type: p.req.type })));
    if (!next || showing) return;
    const d = decide(next.req.type, budgetState());
    if (d.action === 'queue') return;
    const idx = queue.findIndex((p) => p.createdAt === next.createdAt && p.req === next.req);
    const [p] = queue.splice(idx, 1);
    if (d.action === 'show') p.resolve(await show(p.req));
    else {
      if (p.req.fallbackExpression) emit('mascot:react', { state: p.req.fallbackExpression, ms: 4000 });
      logInterruption(p.req.type, 'dropped');
      p.resolve(null);
    }
  },

  setMeeting(on: boolean): void {
    inMeeting = on;
    if (!on) void this.tick();
  },

  inMeeting(): boolean {
    return inMeeting;
  },

  queued(): number {
    return queue.length;
  },
};
