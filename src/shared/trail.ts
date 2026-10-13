// Trilha de objetivos: o plano desmembrado em ações, uma por dia, com a data final que escorrega
// quando uma ação atrasa. Só funções puras aqui (tests/trail.test.ts).

export type GoalStatus = 'active' | 'done' | 'archived';

export interface GoalAction {
  id: number;
  goalId: number;
  /** Etapa (rótulo). Ações seguidas com a mesma etapa formam um grupo na trilha. */
  stage: string;
  title: string;
  notes: string;
  position: number;
  /** Dia em que está marcada agora (AAAA-MM-DD). */
  day: string;
  /** Dia em que foi marcada no plano original: a diferença é o quanto escorregou. */
  plannedDay: string;
  doneAt: string | null;
}

export interface Goal {
  id: number;
  title: string;
  /** O resultado que o usuário quer alcançar. */
  outcome: string;
  /** Data que o usuário queria (AAAA-MM-DD). A data real de fim sai da última ação. */
  targetDate: string | null;
  /** Dias da semana em que este plano tem ação (0 = domingo). */
  weekdays: number[];
  status: GoalStatus;
  createdAt: string;
  finishedAt: string | null;
  actions: GoalAction[];
}

export interface GoalInput {
  title: string;
  outcome?: string;
  targetDate?: string | null;
  weekdays?: number[];
  stages?: StageInput[];
}

export type StageInput = { title: string; actions: Array<string | { title: string; notes?: string; day?: string }> };

export type GoalPatch = Partial<Pick<Goal, 'title' | 'outcome' | 'targetDate' | 'weekdays' | 'status'>>;

export interface ActionInput {
  title: string;
  notes?: string;
  /** Sem etapa: herda a da ação anterior. */
  stage?: string;
  /** Entra logo depois desta ação (0 = no começo); sem isso, vai para o fim da trilha. */
  afterId?: number | null;
}

export type ActionPatch = Partial<Pick<GoalAction, 'title' | 'notes' | 'stage' | 'day'>>;

export interface GoalSummary {
  total: number;
  done: number;
  /** A próxima ação a fazer (a primeira pendente). */
  current: GoalAction | null;
  /** A ação atual é para hoje (ou já deveria ter sido feita)? */
  dueToday: boolean;
  /** Ações concluídas hoje. */
  doneToday: number;
  /** Dia em que o plano termina, pelo ritmo atual. */
  endDay: string | null;
  /** Dias que o fim escorregou em relação ao que o usuário queria (ou ao plano original). */
  slipDays: number;
}

export type CanWork = (day: string) => boolean;

const pad = (n: number): string => String(n).padStart(2, '0');

export function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Meio-dia local: somar dias nunca cai no dia errado por causa do horário de verão. */
export function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && keyOf(dateOf(v)) === v;
}

export function addDaysKey(key: string, n: number): string {
  const d = dateOf(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "hoje", "amanhã", "seg 13/10" (com o ano quando não é o atual). */
export function fmtDay(key: string, today: string): string {
  const diff = diffDays(today, key);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  const d = dateOf(key);
  const year = key.slice(0, 4) === today.slice(0, 4) ? '' : `/${key.slice(2, 4)}`;
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year}`;
}

/** Dias em que o plano anda: o dia da semana tem de estar entre os escolhidos e não pode ser folga. */
export function workOn(weekdays: number[], isOff: (day: string) => boolean = () => false): CanWork {
  const set = new Set(weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6]);
  return (day) => set.has(dateOf(day).getDay()) && !isOff(day);
}

/** Primeiro dia livre a partir de `from` (inclusive). */
export function nextFreeDay(from: string, canWork: CanWork): string {
  let d = from;
  // Um ano de folgas seguidas não existe: o limite só evita laço infinito com dados quebrados.
  for (let i = 0; i < 370 && !canWork(d); i++) d = addDaysKey(d, 1);
  return d;
}

const byPosition = (a: GoalAction, b: GoalAction): number => a.position - b.position || a.id - b.id;

export function ordered(actions: GoalAction[]): GoalAction[] {
  return [...actions].sort(byPosition);
}

/** Dias livres depois de `from` até `to` (inclusive). */
function freeDaysBetween(from: string, to: string, canWork: CanWork): number {
  let n = 0;
  let d = from;
  for (let i = 0; i < 800 && d < to; i++) {
    d = addDaysKey(d, 1);
    if (canWork(d)) n++;
  }
  return n;
}

/** Anda `n` dias livres para a frente. */
function advance(from: string, n: number, canWork: CanWork): string {
  let d = from;
  for (let i = 0; i < n; i++) d = nextFreeDay(addDaysKey(d, 1), canWork);
  return d;
}

/**
 * Recalcula os dias das ações pendentes. Devolve só o que mudou.
 * - Se a próxima ação ficou para trás, ela vem para hoje e as seguintes escorregam junto, mantendo
 *   o espaço (em dias livres) que havia entre elas: a data final do objetivo anda, sem punição.
 * - Uma ação por dia, na ordem da trilha, sempre em dia em que o plano anda.
 */
export function reflow(actions: GoalAction[], today: string, canWork: CanWork): Array<{ id: number; day: string }> {
  const pending = ordered(actions).filter((a) => !a.doneAt);
  if (!pending.length) return [];
  const start = nextFreeDay(today, canWork);
  const late = pending[0].day < start;
  const changes: Array<{ id: number; day: string }> = [];
  let prevOld: string | null = null;
  let prev: string | null = null;
  for (const a of pending) {
    let d = a.day;
    if (late) d = prev && prevOld ? advance(prev, Math.max(1, freeDaysBetween(prevOld, a.day, canWork)), canWork) : start;
    if (d < start) d = start;
    if (prev && d <= prev) d = addDaysKey(prev, 1);
    d = nextFreeDay(d, canWork);
    if (d !== a.day) changes.push({ id: a.id, day: d });
    prevOld = a.day;
    prev = d;
  }
  return changes;
}

/** Volta `n` dias livres. */
function retreat(from: string, n: number, canWork: CanWork): string {
  let d = from;
  for (let i = 0; i < n; i++) {
    d = addDaysKey(d, -1);
    for (let j = 0; j < 370 && !canWork(d); j++) d = addDaysKey(d, -1);
  }
  return d;
}

/**
 * Uma ação marcada para `day` foi feita hoje, antes da hora: as pendentes que vêm depois dela
 * chegam mais cedo o mesmo tanto (em dias livres), e a data final do objetivo recua junto.
 * Nenhuma volta para hoje: amanhã sempre tem a próxima.
 */
export function pullEarlier(actions: GoalAction[], done: Pick<GoalAction, 'position' | 'day'>, today: string, canWork: CanWork): Array<{ id: number; day: string }> {
  const early = freeDaysBetween(today, done.day, canWork);
  if (early <= 0) return [];
  const floor = nextFreeDay(addDaysKey(today, 1), canWork);
  const changes: Array<{ id: number; day: string }> = [];
  let prev: string | null = null;
  for (const a of ordered(actions).filter((x) => !x.doneAt && x.position > done.position)) {
    let d = retreat(a.day, early, canWork);
    if (d < floor) d = floor;
    if (prev && d <= prev) d = nextFreeDay(addDaysKey(prev, 1), canWork);
    if (d !== a.day) changes.push({ id: a.id, day: d });
    prev = d;
  }
  return changes;
}

/** Dias seguidos (livres) para `count` ações, a partir de `from`. */
export function consecutiveDays(count: number, from: string, canWork: CanWork): string[] {
  const days: string[] = [];
  let d = nextFreeDay(from, canWork);
  for (let i = 0; i < count; i++) {
    days.push(d);
    d = nextFreeDay(addDaysKey(d, 1), canWork);
  }
  return days;
}

/**
 * Muda a ordem das pendentes: as vagas (posição, dia e etapa) ficam onde estão e as ações trocam
 * de vaga. `ids` é a nova ordem das pendentes.
 */
export function reorderPending(actions: GoalAction[], ids: number[]): Array<{ id: number; position: number; day: string; stage: string }> {
  const pending = ordered(actions).filter((a) => !a.doneAt);
  const byId = new Map(pending.map((a) => [a.id, a]));
  const next = [...new Set(ids)].filter((id) => byId.has(id));
  for (const a of pending) if (!next.includes(a.id)) next.push(a.id);
  const days = pending.map((a) => a.day).sort();
  return next.map((id, i) => ({ id, position: pending[i].position, day: days[i], stage: pending[i].stage }));
}

export function summarize(goal: Goal, today: string): GoalSummary {
  const list = ordered(goal.actions);
  const pending = list.filter((a) => !a.doneAt);
  const current = pending[0] ?? null;
  const last = list[list.length - 1] ?? null;
  const lastPending = pending[pending.length - 1] ?? null;
  const endDay = lastPending?.day ?? (last?.doneAt ? keyOf(new Date(last.doneAt)) : null);
  const wanted = goal.targetDate ?? last?.plannedDay ?? null;
  return {
    total: list.length,
    done: list.length - pending.length,
    current,
    dueToday: !!current && current.day <= today,
    doneToday: list.filter((a) => a.doneAt && keyOf(new Date(a.doneAt)) === today).length,
    endDay,
    slipDays: endDay && wanted ? Math.max(0, diffDays(wanted, endDay)) : 0,
  };
}

/** Grupos da trilha: ações seguidas com a mesma etapa. */
export function stagesOf(actions: GoalAction[]): Array<{ stage: string; actions: GoalAction[] }> {
  const groups: Array<{ stage: string; actions: GoalAction[] }> = [];
  for (const a of ordered(actions)) {
    const g = groups[groups.length - 1];
    if (g && g.stage === a.stage) g.actions.push(a);
    else groups.push({ stage: a.stage, actions: [a] });
  }
  return groups;
}
