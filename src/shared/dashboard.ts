// Tipos dos dashboards (Fase 22).
import type { DayKind } from './types';

export interface DashRange {
  kind: 'today' | 'week' | 'month' | 'year' | 'custom';
  /** AAAA-MM-DD, inclusive. */
  from: string;
  to: string;
}

/** Um dia do período, contado pelo que foi feito (não por horas). */
export interface DashDay {
  date: string;
  weekday: number;
  /** Atividades feitas: tarefas concluídas mais ações da trilha. */
  done: number;
  tasksDone: number;
  actionsDone: number;
  /** Tarefas cadastradas no dia. */
  created: number;
  mood: number | null;
  status: DayKind | null;
  statusNote: string | null;
  /** Dia útil de verdade (não é folga/férias/feriado). */
  workday: boolean;
}

/** Uma atividade feita no período. */
export interface DashActivity {
  at: string;
  date: string;
  kind: 'task' | 'action';
  title: string;
  /** Cliente da tarefa ou plano da ação. */
  where: string | null;
  color: string | null;
}

export interface DashPipo {
  pipoId: number;
  name: string;
  color: string;
  runs: number;
  ok: number;
  failed: number;
  avgSec: number | null;
  savedMin: number;
  lastFailure: { at: string; error: string | null } | null;
  metrics: Array<{ key: string; label: string; stage: number | null; total: number }>;
  versions: Array<{ version: number; runs: number; metrics: Record<string, number>; changelog: string }>;
}

export interface DashData {
  range: DashRange;
  totals: {
    done: number;
    tasksDone: number;
    actionsDone: number;
    created: number;
    /** Dias (até hoje) com pelo menos uma atividade feita. */
    activeDays: number;
    /** Dias úteis do período até hoje e quantos deles tiveram atividade. */
    workdays: number;
    activeWorkdays: number;
    /** Média de atividades nos dias com atividade. */
    perActiveDay: number;
    bestDay: { date: string; done: number } | null;
    /** Maior sequência de dias úteis seguidos com atividade dentro do período (folgas não quebram). */
    longestRun: number;
    daysOff: number;
    vacationDays: number;
    holidays: number;
    moodAvg: number | null;
  };
  days: DashDay[];
  /** [dia da semana 0–6][hora 0–23] = atividades feitas. */
  rhythm: number[][];
  /** O que foi feito, da mais nova para a mais antiga. */
  activities: DashActivity[];
  /** Atividades que não couberam na lista. */
  activitiesMore: number;
  clients: Array<{ id: number | null; name: string; color: string; done: number; open: number }>;
  /** Planos da trilha: o que andou no período e o total. */
  goals: Array<{ id: number; title: string; status: string; doneInRange: number; done: number; total: number }>;
  team: DashPipo[];
  money: { currency: string; total: number; days: Array<{ date: string; amount: number }> } | null;
  streak: { current: number; best: number };
}

// ---------- Painel de cada Pipo ----------

/** Cartões do painel de um Pipo. A ordem e quais aparecem são do usuário. */
export type PipoCardId = 'results' | 'status' | 'overTime' | 'compare' | 'funnel' | 'failures' | 'outputs' | 'timeline';

export const PIPO_CARDS: PipoCardId[] = ['results', 'status', 'overTime', 'compare', 'funnel', 'failures', 'outputs', 'timeline'];

export interface PipoDashConfig {
  /** Métrica em destaque (chave); null usa a principal do plano. */
  headline: string | null;
  order: PipoCardId[];
  hidden: PipoCardId[];
}

/** Completa a configuração salva: cartões novos entram no fim, chaves desconhecidas saem. */
export function normalizePipoConfig(c: Partial<PipoDashConfig> | null | undefined): PipoDashConfig {
  const known = (x: unknown): x is PipoCardId => PIPO_CARDS.includes(x as PipoCardId);
  const order = [...new Set((c?.order ?? []).filter(known))];
  for (const id of PIPO_CARDS) if (!order.includes(id)) order.push(id);
  return { headline: typeof c?.headline === 'string' && c.headline ? c.headline : null, order, hidden: [...new Set((c?.hidden ?? []).filter(known))] };
}

export type PipoOutputMedia = 'video' | 'image' | 'audio' | 'doc' | 'other' | 'link';

/** Algo que uma execução produziu: um arquivo no computador ou um link. */
export interface PipoDashOutput {
  runId: number;
  at: string;
  /** Passo que devolveu (título), se der para saber. */
  step: string | null;
  kind: 'file' | 'link';
  media: PipoOutputMedia;
  label: string;
  /** Caminho completo ou URL. */
  target: string;
}

export interface PipoDashRun {
  id: number;
  startedAt: string;
  durationSec: number | null;
  trigger: string;
  status: string;
  version: number;
  summary: string | null;
  error: string | null;
  /** Passo em que parou, quando falhou. */
  failedStep: string | null;
  metrics: Record<string, number>;
  tokens: number;
  outputs: number;
}

export interface PipoDashTotals {
  runs: number;
  ok: number;
  failed: number;
  cancelled: number;
  avgSec: number | null;
  savedMin: number;
  /** Tokens das execuções do período (entrada + saída), ensaios incluídos. */
  tokens: number;
  metrics: Record<string, number>;
}

export interface PipoDash {
  range: DashRange;
  prevRange: DashRange;
  pipo: { id: number; slug: string; name: string; color: string; accessory: string; mission: string; paused: boolean; version: number | null };
  config: PipoDashConfig;
  /** Métricas do plano ativo; `headline` marca a de destaque. */
  metrics: Array<{ key: string; label: string; stage: number | null; total: number; prev: number; headline: boolean }>;
  totals: PipoDashTotals;
  prev: PipoDashTotals;
  days: Array<{ date: string; weekday: number; runs: number; ok: number; failed: number; metrics: Record<string, number> }>;
  /** Execuções reais do período, da mais nova para a mais antiga. */
  runs: PipoDashRun[];
  failures: Array<{ reason: string; step: string | null; count: number; lastAt: string; lastRunId: number }>;
  outputs: PipoDashOutput[];
  /** Itens produzidos que não couberam na lista. */
  outputsMore: number;
  pending: Array<{ kind: 'approval' | 'inbox'; runId: number | null; title: string; since: string; runAfter: string | null }>;
  nextRunAt: string | null;
  /** Como o usuário descreveu a agenda ("seg–sex 9h"), se houver. */
  schedule: string | null;
  /** Mês corrente (não depende do período escolhido). */
  month: { tokens: number; runs: number };
  /** Média de tokens por execução real do período que usou o agente. */
  tokensPerRun: number | null;
}

/** Cartões que ocupam a linha inteira; os outros dividem a linha em dois. */
const PIPO_WIDE: PipoCardId[] = ['results', 'status', 'timeline'];

/** Empacota os cartões em linhas de duas colunas: um estreito sem par ocupa a linha inteira. */
export function packPipoCards(ids: PipoCardId[]): Array<{ id: PipoCardId; wide: boolean }> {
  const out: Array<{ id: PipoCardId; wide: boolean }> = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const next = ids[i + 1];
    if (!PIPO_WIDE.includes(id) && next && !PIPO_WIDE.includes(next)) {
      out.push({ id, wide: false }, { id: next, wide: false });
      i++;
    } else out.push({ id, wide: true });
  }
  return out;
}

/** Maior sequência de dias úteis seguidos com atividade (a mesma regra da sequência): folga e fim de semana nem contam nem quebram. */
export function longestRun(days: Array<Pick<DashDay, 'done' | 'workday'>>): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (!d.workday) continue;
    if (d.done > 0) best = Math.max(best, ++run);
    else run = 0;
  }
  return best;
}
