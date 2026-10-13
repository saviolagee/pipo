// Ferramentas do Pipo branco para a trilha de objetivos: criar o plano e ajustar pelo chat.
import { fmtDay, isDayKey, ordered, summarize, type Goal, type StageInput } from '@shared/trail';
import { addAction, createGoal, deleteAction, getGoal, listGoals, planEnd, reorderActions, replacePending, setActionDone, updateAction, updateGoal } from '../db/repos/goals';
import type { ToolDef } from '../mcp/tools';
import { dayKey } from '../time';

type Args = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const today = (): string => dayKey(new Date());

function stagesOf(v: unknown): StageInput[] {
  if (!Array.isArray(v)) return [];
  return (v as Array<{ title?: unknown; actions?: unknown }>)
    .map((s) => ({
      title: str(s?.title) ?? '',
      actions: Array.isArray(s?.actions)
        ? (s.actions as unknown[]).map((a) => (typeof a === 'string' ? a : { title: String((a as Args)?.title ?? ''), notes: str((a as Args)?.notes), day: isDayKey((a as Args)?.day) ? ((a as Args).day as string) : undefined }))
        : [],
    }))
    .filter((s) => s.actions.length);
}

const countActions = (stages: StageInput[]): number => stages.reduce((n, s) => n + s.actions.length, 0);

function weekdaysOf(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return list.length ? [...new Set(list)] : undefined;
}

function requireGoal(id: unknown): Goal {
  const n = num(id);
  const g = n ? getGoal(n) : null;
  if (!g) throw new Error(`Plano ${String(id)} não encontrado. Use list_goals para ver os ids.`);
  return g;
}

function view(g: Goal): Record<string, unknown> {
  const s = summarize(g, today());
  return {
    id: g.id,
    title: g.title,
    outcome: g.outcome || undefined,
    status: g.status,
    wanted_date: g.targetDate,
    ends: s.endDay,
    slipped_days: s.slipDays,
    progress: `${s.done}/${s.total}`,
    next_action: s.current && { id: s.current.id, title: s.current.title, day: s.current.day, for_today: s.dueToday },
    weekdays: g.weekdays,
    trail: ordered(g.actions).map((a) => ({ id: a.id, stage: a.stage || undefined, title: a.title, day: a.day, done: !!a.doneAt, notes: a.notes || undefined })),
  };
}

const STAGES_SCHEMA = {
  type: 'array',
  description: 'Etapas em ordem; cada uma com as ações em ordem. Cada ação é um texto ou {title, notes, day}. day (AAAA-MM-DD) é opcional: sem ele, é uma ação por dia em sequência.',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      actions: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { title: { type: 'string' }, notes: { type: 'string' }, day: { type: 'string' } }, required: ['title'] }] } },
    },
    required: ['title', 'actions'],
  },
};

interface Change {
  op: 'add' | 'update' | 'remove' | 'done' | 'undone';
  id?: number;
  title?: string;
  notes?: string;
  stage?: string;
  day?: string;
  after_id?: number;
}

function changesOf(v: unknown): Change[] {
  if (!Array.isArray(v)) return [];
  return (v as Args[]).map((c) => ({
    op: (str(c?.op) ?? 'update') as Change['op'],
    id: num(c?.id),
    title: str(c?.title),
    notes: typeof c?.notes === 'string' ? c.notes : undefined,
    stage: typeof c?.stage === 'string' ? c.stage : undefined,
    day: str(c?.day),
    after_id: num(c?.after_id),
  }));
}

function describeChanges(g: Goal, changes: Change[], reorder: boolean): string {
  const name = (id?: number): string => g.actions.find((a) => a.id === id)?.title ?? `#${id ?? '?'}`;
  const parts = changes.map((c) => {
    if (c.op === 'add') return `+ ${c.title ?? ''}`;
    if (c.op === 'remove') return `− ${name(c.id)}`;
    if (c.op === 'done') return `✓ ${name(c.id)}`;
    if (c.op === 'undone') return `↺ ${name(c.id)}`;
    return `✎ ${c.title ?? name(c.id)}${c.day ? ` → ${fmtDay(c.day, today())}` : ''}`;
  });
  if (reorder) parts.push('nova ordem');
  return parts.join(' · ');
}

export function goalTools(changed: () => void): ToolDef[] {
  return [
    {
      name: 'list_goals',
      modes: ['chat'],
      description:
        'Planos do usuário (trilha de objetivos): resultado, data desejada, data em que termina pelo ritmo atual (ends), quantos dias escorregou, progresso, a próxima ação e a trilha inteira com os ids das ações.',
      inputSchema: { type: 'object', properties: { include_archived: { type: 'boolean' } } },
      run: (a) => listGoals(a.include_archived === true).map(view),
    },
    {
      name: 'create_goal',
      modes: ['chat'],
      description:
        'Cria um plano: o resultado que o usuário quer, a data desejada e o desmembramento em etapas e em ações de um dia cada (uma ação por dia, em sequência, a partir de hoje, nos dias em que ele trabalha). target_date em AAAA-MM-DD. weekdays opcional (0=domingo…6=sábado).',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, outcome: { type: 'string' }, target_date: { type: 'string' }, weekdays: { type: 'array', items: { type: 'number' } }, stages: STAGES_SCHEMA },
        required: ['title', 'stages'],
      },
      confirm: (a) => {
        const stages = stagesOf(a.stages);
        const n = countActions(stages);
        const end = planEnd(n, weekdaysOf(a.weekdays));
        return { label: 'novo plano', title: str(a.title) ?? 'Plano', subject: `${n} ações em ${stages.length} etapas${end ? ` · termina ${fmtDay(end, today())}` : ''}`, confirm: 'Criar plano' };
      },
      run: (a) => {
        const stages = stagesOf(a.stages);
        if (!countActions(stages)) throw new Error('O plano precisa de pelo menos uma ação.');
        const g = createGoal({ title: str(a.title) ?? '', outcome: str(a.outcome), targetDate: isDayKey(a.target_date) ? a.target_date : null, weekdays: weekdaysOf(a.weekdays), stages });
        changed();
        return view(g);
      },
    },
    {
      name: 'update_goal',
      modes: ['chat'],
      description: "Altera um plano: title, outcome, target_date (AAAA-MM-DD), weekdays (0=domingo…6=sábado) ou status ('active' | 'archived').",
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' }, title: { type: 'string' }, outcome: { type: 'string' }, target_date: { type: 'string' }, weekdays: { type: 'array', items: { type: 'number' } }, status: { type: 'string', enum: ['active', 'archived'] } },
        required: ['id'],
      },
      confirm: (a) => {
        const g = requireGoal(a.id);
        const parts: string[] = [];
        if (str(a.title)) parts.push(`nome “${str(a.title)}”`);
        if (str(a.outcome)) parts.push('resultado');
        if (a.target_date !== undefined) parts.push(isDayKey(a.target_date) ? `data desejada ${fmtDay(a.target_date, today())}` : 'sem data desejada');
        if (weekdaysOf(a.weekdays)) parts.push('dias da semana');
        if (str(a.status)) parts.push(a.status === 'archived' ? 'arquivar' : 'reativar');
        return { label: 'plano', subject: `Alterar “${g.title}”: ${parts.join(', ') || 'nada'}` };
      },
      run: (a) => {
        const g = requireGoal(a.id);
        const next = updateGoal(g.id, {
          title: str(a.title),
          outcome: str(a.outcome),
          targetDate: a.target_date !== undefined ? (isDayKey(a.target_date) ? a.target_date : null) : undefined,
          weekdays: weekdaysOf(a.weekdays),
          status: a.status === 'archived' || a.status === 'active' ? a.status : undefined,
        });
        changed();
        return view(next);
      },
    },
    {
      name: 'edit_goal_actions',
      modes: ['chat'],
      description:
        "Ajustes pontuais na trilha de um plano, todos de uma vez. changes: [{op:'add', title, stage?, notes?, after_id?} | {op:'update', id, title?, notes?, stage?, day?} | {op:'remove', id} | {op:'done', id} | {op:'undone', id}]. after_id = id da ação que vem antes (0 = começo; sem ele, no fim). order (opcional) = ids das ações pendentes na nova ordem. Mudar o dia de uma ação empurra as seguintes.",
      inputSchema: {
        type: 'object',
        properties: {
          goal_id: { type: 'number' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: { op: { type: 'string', enum: ['add', 'update', 'remove', 'done', 'undone'] }, id: { type: 'number' }, title: { type: 'string' }, notes: { type: 'string' }, stage: { type: 'string' }, day: { type: 'string' }, after_id: { type: 'number' } },
              required: ['op'],
            },
          },
          order: { type: 'array', items: { type: 'number' } },
        },
        required: ['goal_id'],
      },
      confirm: (a) => {
        const g = requireGoal(a.goal_id);
        return { label: 'ajustar plano', title: g.title, subject: describeChanges(g, changesOf(a.changes), Array.isArray(a.order)) || 'nada' };
      },
      run: (a) => {
        const g = requireGoal(a.goal_id);
        const own = (id?: number): number => {
          if (!id || !getGoal(g.id)?.actions.some((x) => x.id === id)) throw new Error(`A ação ${String(id)} não é deste plano. Use list_goals para ver os ids.`);
          return id;
        };
        for (const c of changesOf(a.changes)) {
          if (c.op === 'add') {
            if (!c.title) throw new Error('add precisa de title.');
            addAction(g.id, { title: c.title, notes: c.notes, stage: c.stage, afterId: c.after_id });
          } else if (c.op === 'remove') deleteAction(own(c.id));
          else if (c.op === 'done' || c.op === 'undone') setActionDone(own(c.id), c.op === 'done');
          else updateAction(own(c.id), { title: c.title, notes: c.notes, stage: c.stage, day: c.day });
        }
        if (Array.isArray(a.order)) reorderActions(g.id, a.order.map(Number));
        changed();
        return view(requireGoal(g.id));
      },
    },
    {
      name: 'replan_goal',
      modes: ['chat'],
      description: 'Refaz o que falta de um plano: troca todas as ações pendentes por um novo desmembramento (o que já foi feito fica). Use quando o usuário pedir para replanejar; para mudanças pequenas, use edit_goal_actions.',
      inputSchema: { type: 'object', properties: { goal_id: { type: 'number' }, stages: STAGES_SCHEMA }, required: ['goal_id', 'stages'] },
      confirm: (a) => {
        const g = requireGoal(a.goal_id);
        const stages = stagesOf(a.stages);
        const n = countActions(stages);
        const end = planEnd(n, g.weekdays);
        return { label: 'refazer plano', title: g.title, subject: `${n} ações em ${stages.length} etapas no lugar das ${g.actions.filter((x) => !x.doneAt).length} pendentes${end ? ` · termina ${fmtDay(end, today())}` : ''}`, confirm: 'Refazer' };
      },
      run: (a) => {
        const g = requireGoal(a.goal_id);
        const stages = stagesOf(a.stages);
        if (!countActions(stages)) throw new Error('O novo plano precisa de pelo menos uma ação.');
        const next = replacePending(g.id, stages);
        changed();
        return view(next);
      },
    },
  ];
}
