// Ferramentas expostas ao Claude pelo servidor MCP "pipo" (seção 11.1).
import { fmtDue, fmtHM, WEEKDAYS_LONG } from '@shared/format';
import { parseCapture } from '@shared/parse-capture';
import type { CalendarEvent, PatternSuggestion, Priority, Task, TaskFilter, TimeReportRow } from '@shared/types';
import { timeReport } from '../../activity/review';
import { currentActivity } from '../../activity/tracker';
import { emit } from '../../bus';
import { blocksBetween, setBlockClient } from '../../db/repos/activity';
import { findClient, getClient, listClients, norm } from '../../db/repos/clients';
import { getProfile } from '../../db/repos/profile';
import { listRituals } from '../../db/repos/rituals';
import { addSubtasks, completeTask, createTask, getTask, listTasks, updateTask } from '../../db/repos/tasks';
import { focusState, startFocus } from '../../focus/session';
import { statsFor, todayStats } from '../../stats';
import { tasksChanged } from '../../tasks/ipc';
import { dayRange } from '../../time';
import { confirmAction, type ConfirmSpec } from '../confirm-bridge';
import type { ToolDescriptor } from '../protocol';

export interface ToolCtx {
  /**
   * 'capture': captura rápida (cria direto, sem confirmação).
   * 'builder': conversa do /criarpipo (ferramentas de construção do Pipo colorido).
   * 'pipo': conversa com um Pipo colorido (Fase 20).
   */
  mode: 'chat' | 'capture' | 'builder' | 'pipo';
  conversationId: number | null;
  /** Rascunho do /criarpipo ligado a esta conversa. */
  draftId?: number | null;
  /** Pipo colorido dono da conversa. */
  pipoId?: number | null;
}

type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  /** Modos em que aparece. Padrão: chat e captura (as do Pipo branco). */
  modes?: Array<ToolCtx['mode']>;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Altera dados → confirmação (exceto quando liberado). */
  confirm?: (args: Args, ctx: ToolCtx) => ConfirmSpec | null;
  run: (args: Args, ctx: ToolCtx) => Promise<unknown> | unknown;
}

/** Ganchos preenchidos pelas integrações (Fases 10 e 11). */
export const agentHooks: {
  calendar: ((from: string, to: string) => Promise<CalendarEvent[]>) | null;
  createBlock: ((b: { title: string; start: string; end: string; recurrence?: string }) => Promise<CalendarEvent>) | null;
  unreadEmails: ((max: number) => Promise<Array<{ from: string; subject: string; snippet: string; date: string }>>) | null;
  patterns: ((weeks: number) => PatternSuggestion[]) | null;
  mood: (() => { mood: number; phrase: string }) | null;
} = { calendar: null, createBlock: null, unreadEmails: null, patterns: null, mood: null };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);

/** Aceita ISO ou texto natural ("sexta 10h", "amanhã"). */
function parseDue(v: unknown): string | null | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s))) return new Date(s).toISOString();
  return parseCapture(`x ${s}`, []).dueAt;
}

function clientIdFrom(v: unknown): number | null | undefined {
  if (typeof v === 'number') return getClient(v)?.id ?? null;
  const s = str(v);
  if (!s) return undefined;
  return findClient(s)?.id ?? null;
}

function taskView(t: Task): Record<string, unknown> {
  const c = t.clientId ? getClient(t.clientId) : null;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    today: t.isToday,
    due: t.dueAt,
    estimate_min: t.estimateMin,
    priority: t.priority,
    client: c?.name ?? null,
    snoozed_times: t.snoozeCount,
    notes: t.notes || undefined,
    subtasks: t.subtasks.length ? t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })) : undefined,
  };
}

function describeTask(title: string, due: string | null | undefined, est: number | undefined, clientId: number | null | undefined): string {
  const parts = [title];
  if (due) parts.push(fmtDue(due));
  if (est) parts.push(`~${fmtHM(est)}`);
  if (clientId) parts.push(`#${getClient(clientId)?.name ?? ''}`);
  return parts.join(' · ');
}

function requireTask(id: unknown): Task {
  const n = num(id);
  const t = n ? getTask(n) : null;
  if (!t) throw new Error(`Tarefa ${String(id)} não encontrada. Use list_tasks para ver os ids.`);
  return t;
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_context',
    description:
      'Contexto atual: data/hora local, dia da semana, perfil (meta, horário, energia, formato de foco, rituais, clientes), foco ativo, app em uso (sem título da janela), humor do Pipo e horas de hoje vs meta. Chame antes de interpretar datas relativas.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const now = new Date();
      const p = getProfile();
      const s = todayStats();
      const f = focusState();
      const a = currentActivity();
      return {
        now: now.toISOString(),
        local: `${WEEKDAYS_LONG[now.getDay()]}, ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        profile: p && {
          name: p.name,
          work_days: p.workDays.map((d) => WEEKDAYS_LONG[d]),
          hours: `${p.startTime}–${p.endTime}`,
          lunch: `${p.lunchStart} (${p.lunchMin} min)`,
          daily_goal: fmtHM(s.goalMin),
          energy_peak: p.energyPeak,
          focus: `${p.focusPreset.focusMin}/${p.focusPreset.breakMin} × ${p.focusPreset.cycles}`,
        },
        rituals: listRituals()
          .filter((r) => r.enabled)
          .map((r) => r.label),
        clients: listClients().map((c) => c.name),
        today: {
          worked: fmtHM(s.workedMin),
          goal: fmtHM(s.goalMin),
          planned: fmtHM(s.plannedMin),
          meetings: fmtHM(s.meetingMin),
          open_tasks: s.openTodayTasks,
          focus_sessions_completed: s.focusSessionsCompleted,
          next_meeting: s.nextMeeting ? `${s.nextMeeting.title} às ${new Date(s.nextMeeting.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : null,
        },
        focus: f && { task: f.taskTitle, phase: f.phase, remaining_min: Math.round(f.remainingSec / 60), cycle: `${f.cycle}/${f.totalCycles}` },
        current_app: a ? { app: a.app, category: a.category, client: a.clientId ? getClient(a.clientId)?.name : null } : null,
        mood: agentHooks.mood?.() ?? null,
      };
    },
  },
  {
    name: 'list_tasks',
    description:
      "Lista tarefas. filter: 'open' (todas não concluídas, padrão) | 'today' | 'upcoming' | 'someday' | 'overdue' | 'done_today'. query busca no título (use para achar uma tarefa pelo nome numa chamada só). client opcional (nome).",
    inputSchema: {
      type: 'object',
      properties: { filter: { type: 'string', enum: ['open', 'today', 'upcoming', 'someday', 'overdue', 'done_today'] }, query: { type: 'string' }, client: { type: 'string' } },
    },
    run: (a) => {
      const filter = (str(a.filter) ?? 'open') as TaskFilter;
      let tasks = listTasks(filter);
      const cid = clientIdFrom(a.client);
      if (cid) tasks = tasks.filter((t) => t.clientId === cid);
      const q = str(a.query);
      if (q) {
        const nq = norm(q);
        const words = nq.split(/\s+/).filter((w) => w.length > 2);
        tasks = tasks.filter((t) => {
          const nt = norm(t.title);
          return nt.includes(nq) || (words.length > 0 && words.every((w) => nt.includes(w)));
        });
      }
      return tasks.map(taskView);
    },
  },
  {
    name: 'create_task',
    description:
      'Cria uma tarefa. due aceita ISO 8601 ou texto ("sexta 10h"). estimate_min em minutos. priority 1 (baixa) a 3 (alta). client = nome do cliente. subtasks = lista de passos. today=true coloca na lista de Hoje.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due: { type: 'string' },
        estimate_min: { type: 'number' },
        priority: { type: 'number', enum: [1, 2, 3] },
        client: { type: 'string' },
        subtasks: { type: 'array', items: { type: 'string' } },
        today: { type: 'boolean' },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
    confirm: (a, ctx) => (ctx.mode === 'capture' ? null : { subject: `Criar tarefa: ${describeTask(str(a.title) ?? '', parseDue(a.due), num(a.estimate_min), clientIdFrom(a.client))}` }),
    run: (a, ctx) => {
      const title = str(a.title);
      if (!title) throw new Error('title é obrigatório');
      const t = createTask({
        title,
        notes: str(a.notes),
        dueAt: parseDue(a.due) ?? null,
        estimateMin: num(a.estimate_min) ?? null,
        priority: (num(a.priority) as Priority | undefined) ?? 2,
        clientId: clientIdFrom(a.client) ?? null,
        subtasks: Array.isArray(a.subtasks) ? a.subtasks.map(String) : undefined,
        isToday: a.today === true ? true : undefined,
        source: ctx.mode === 'capture' ? 'voice' : 'agent',
      });
      tasksChanged();
      if (ctx.mode === 'capture') emit('toast:show', { id: `task:${t.id}`, text: `Anotado: ${describeTask(t.title, t.dueAt, t.estimateMin ?? undefined, null)}`, undoable: true, durationMs: 5000 });
      return taskView(t);
    },
  },
  {
    name: 'update_task',
    description: 'Altera campos de uma tarefa (title, due, estimate_min, priority, client, notes, today).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        due: { type: 'string' },
        estimate_min: { type: 'number' },
        priority: { type: 'number', enum: [1, 2, 3] },
        client: { type: 'string' },
        notes: { type: 'string' },
        today: { type: 'boolean' },
      },
      required: ['id'],
    },
    confirm: (a) => {
      const t = requireTask(a.id);
      const changes: string[] = [];
      if (str(a.title)) changes.push(`título “${str(a.title)}”`);
      if (a.due !== undefined) changes.push(`prazo ${parseDue(a.due) ? fmtDue(parseDue(a.due) as string) : 'sem prazo'}`);
      if (num(a.estimate_min)) changes.push(`~${fmtHM(num(a.estimate_min) as number)}`);
      if (num(a.priority)) changes.push(`prioridade ${num(a.priority)}`);
      if (a.client !== undefined) changes.push(`cliente ${str(a.client) ?? '—'}`);
      if (a.today !== undefined) changes.push(a.today ? 'para hoje' : 'fora de hoje');
      return { subject: `Alterar “${t.title}”: ${changes.join(', ') || 'notas'}` };
    },
    run: (a) => {
      const t = requireTask(a.id);
      const due = parseDue(a.due);
      const updated = updateTask(t.id, {
        title: str(a.title),
        notes: str(a.notes),
        dueAt: a.due !== undefined ? (due ?? null) : undefined,
        estimateMin: num(a.estimate_min),
        priority: num(a.priority) as Priority | undefined,
        clientId: a.client !== undefined ? (clientIdFrom(a.client) ?? null) : undefined,
        isToday: typeof a.today === 'boolean' ? a.today : undefined,
      });
      tasksChanged();
      return taskView(updated);
    },
  },
  {
    name: 'complete_task',
    description: 'Marca uma tarefa como concluída.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    confirm: (a) => ({ subject: `Concluir: ${requireTask(a.id).title}` }),
    run: (a) => {
      const t = completeTask(requireTask(a.id).id, true);
      tasksChanged();
      emit('mascot:react', { state: 'happy', ms: 1200 });
      return taskView(t);
    },
  },
  {
    name: 'add_subtasks',
    description: 'Adiciona subtarefas (passos concretos e curtos) a uma tarefa. Prefira de 3 a 5 passos.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, subtasks: { type: 'array', items: { type: 'string' } } }, required: ['task_id', 'subtasks'] },
    confirm: (a) => {
      const t = requireTask(a.task_id);
      const subs = Array.isArray(a.subtasks) ? a.subtasks.map(String) : [];
      return { subject: `${subs.length} passos em “${t.title}”: ${subs.join(' · ')}`, label: 'quebrar em passos' };
    },
    run: (a) => {
      const t = requireTask(a.task_id);
      const subs = Array.isArray(a.subtasks) ? a.subtasks.map(String).filter(Boolean) : [];
      if (!subs.length) throw new Error('subtasks vazio');
      const updated = addSubtasks(t.id, subs);
      tasksChanged();
      return taskView(updated);
    },
  },
  {
    name: 'plan_day',
    description:
      'Define a lista de Hoje (task_ids, em ordem) e, opcionalmente, blocos de foco na agenda (blocks: [{title, start, end}] em ISO). A soma das estimativas não pode passar da meta de horas menos as reuniões; tarefas a mais devem ficar para os próximos dias.',
    inputSchema: {
      type: 'object',
      properties: {
        task_ids: { type: 'array', items: { type: 'number' } },
        blocks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['title', 'start', 'end'] } },
      },
      required: ['task_ids'],
    },
    confirm: (a) => {
      const ids = Array.isArray(a.task_ids) ? a.task_ids.map(Number) : [];
      const tasks = ids.map((id) => getTask(id)).filter((t): t is Task => !!t);
      const total = tasks.reduce((acc, t) => acc + (t.estimateMin ?? 30), 0);
      const blocks = Array.isArray(a.blocks) && agentHooks.createBlock ? a.blocks.length : 0;
      return {
        label: 'plano do dia',
        subject: `${tasks.length} tarefas · ${fmtHM(total)}${blocks ? ` · ${blocks} blocos na agenda` : ''}`,
        title: tasks.map((t) => t.title).join(' · '),
      };
    },
    run: async (a) => {
      const ids = Array.isArray(a.task_ids) ? a.task_ids.map(Number) : [];
      const tasks = ids.map((id) => getTask(id)).filter((t): t is Task => !!t);
      const s = todayStats();
      const available = Math.max(0, s.goalMin - s.meetingMin);
      const total = tasks.reduce((acc, t) => acc + (t.estimateMin ?? 30), 0);
      if (total > available + 15) {
        throw new Error(`O plano soma ${fmtHM(total)}, mas a meta menos as reuniões é ${fmtHM(available)}. Tire tarefas (ou deixe para amanhã) e tente de novo.`);
      }
      for (const t of listTasks('today')) if (!ids.includes(t.id) && t.isToday) updateTask(t.id, { isToday: false });
      tasks.forEach((t, i) => updateTask(t.id, { isToday: true, position: i + 1 }));
      const created: CalendarEvent[] = [];
      if (Array.isArray(a.blocks) && a.blocks.length && agentHooks.createBlock) {
        for (const b of a.blocks as Array<{ title: string; start: string; end: string }>) created.push(await agentHooks.createBlock(b));
      }
      tasksChanged();
      return { today: tasks.map(taskView), planned: fmtHM(total), available: fmtHM(available), calendar_blocks: created.length, calendar_connected: !!agentHooks.createBlock };
    },
  },
  {
    name: 'start_focus',
    description:
      'Inicia uma sessão de foco numa tarefa. minutes opcional (padrão: formato do usuário). micro_step = primeiro passo de 2 minutos para destravar (inicia um foco curto, use minutes=5).',
    inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, minutes: { type: 'number' }, micro_step: { type: 'string' } }, required: ['task_id'] },
    confirm: (a) => {
      const t = requireTask(a.task_id);
      const micro = str(a.micro_step);
      if (micro) return { label: 'destravar', title: 'Bora só isso?', subject: micro, cancel: 'Agora não', confirm: 'Bora', allowAlways: false };
      return { label: 'foco', subject: `Focar em “${t.title}”${num(a.minutes) ? ` por ${num(a.minutes)} min` : ''}`, confirm: 'Começar' };
    },
    run: async (a) => {
      const t = requireTask(a.task_id);
      const micro = str(a.micro_step) ?? null;
      const s = await startFocus({ taskId: t.id, minutes: num(a.minutes) ?? (micro ? 5 : undefined), microStep: micro });
      emit('ui:navigate', { tab: 'home', expand: true });
      return { started: true, task: t.title, phase: s.phase, minutes: Math.round(s.phaseDurationSec / 60) };
    },
  },
  {
    name: 'get_calendar',
    description: 'Eventos da agenda (Google) entre from e to (ISO).',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    run: async (a) => {
      if (!agentHooks.calendar) return { connected: false, events: [], note: 'Google Agenda não conectada.' };
      const evs = await agentHooks.calendar(str(a.from) ?? new Date().toISOString(), str(a.to) ?? new Date(Date.now() + 86_400_000).toISOString());
      return { connected: true, events: evs.map((e) => ({ title: e.title, start: e.start, end: e.end, meeting: !!e.meetingUrl })) };
    },
  },
  {
    name: 'create_calendar_block',
    description: 'Cria um bloco na Google Agenda (ex.: foco). recurrence opcional em RRULE (ex.: "RRULE:FREQ=WEEKLY;BYDAY=TU").',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, recurrence: { type: 'string' } }, required: ['title', 'start', 'end'] },
    confirm: (a) => ({
      label: 'agenda',
      subject: `${str(a.title)} · ${fmtDue(str(a.start) ?? new Date().toISOString())}–${new Date(str(a.end) ?? '').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${str(a.recurrence) ? ' · recorrente' : ''}`,
    }),
    run: async (a) => {
      if (!agentHooks.createBlock) throw new Error('Google Agenda não conectada. Peça para o usuário conectar em Configurações → Integrações.');
      const ev = await agentHooks.createBlock({ title: str(a.title) ?? 'Foco', start: str(a.start) ?? '', end: str(a.end) ?? '', recurrence: str(a.recurrence) });
      return { created: true, id: ev.id, start: ev.start, end: ev.end };
    },
  },
  {
    name: 'get_time_report',
    description: "Relatório de tempo agregado (sem títulos de janelas) entre from e to (ISO), agrupado por 'client' | 'app' | 'day'.",
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, group_by: { type: 'string', enum: ['client', 'app', 'day'] } }, required: ['from', 'to', 'group_by'] },
    run: (a) => {
      const from = str(a.from) ?? dayRange(new Date()).start;
      const to = str(a.to) ?? new Date().toISOString();
      const rows: TimeReportRow[] = timeReport(from, to, (str(a.group_by) as 'client' | 'app' | 'day') ?? 'client');
      const days: Array<{ date: string; worked: string; goal: string }> = [];
      for (let d = new Date(from); d < new Date(to) && days.length < 31; d.setDate(d.getDate() + 1)) {
        const s = statsFor(new Date(d));
        days.push({ date: s.date, worked: fmtHM(s.workedMin), goal: fmtHM(s.goalMin) });
      }
      return { rows: rows.map((r) => ({ label: r.label, time: fmtHM(r.minutes), minutes: r.minutes })), days };
    },
  },
  {
    name: 'get_unclassified_blocks',
    description: 'Blocos de trabalho sem cliente (id, app, horário e duração) para sugerir o cliente no fechamento do dia. Não inclui títulos de janelas.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: (a) => {
      const r = dayRange(new Date());
      return blocksBetween(str(a.from) ?? r.start, str(a.to) ?? r.end)
        .filter((b) => b.category === 'work' && Date.parse(b.endedAt) - Date.parse(b.startedAt) >= 5 * 60_000)
        .map((b) => ({ id: b.id, app: b.app, start: b.startedAt, minutes: Math.round((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60_000) }));
    },
  },
  {
    name: 'get_window_titles',
    description:
      'Títulos crus das janelas num intervalo (privado). Use SOMENTE quando o usuário pedir explicitamente o que ele fez num período (ex.: "o que eu fiz ontem à tarde?"). O usuário confirma antes.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    confirm: (a) => ({ label: 'privacidade', subject: `Ler títulos das janelas de ${fmtDue(str(a.from) ?? '')} até ${fmtDue(str(a.to) ?? '')}`, confirm: 'Permitir', allowAlways: false }),
    run: (a) =>
      blocksBetween(str(a.from) ?? '', str(a.to) ?? '')
        .filter((b) => !b.idle)
        .slice(0, 200)
        .map((b) => ({ start: b.startedAt, minutes: Math.round((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60_000), app: b.app, title: b.title })),
  },
  {
    name: 'classify_blocks',
    description: 'Atribui clientes a blocos de trabalho: assignments [{block_id, client}] (client = nome).',
    inputSchema: {
      type: 'object',
      properties: { assignments: { type: 'array', items: { type: 'object', properties: { block_id: { type: 'number' }, client: { type: 'string' } }, required: ['block_id', 'client'] } } },
      required: ['assignments'],
    },
    confirm: (a) => {
      const list = Array.isArray(a.assignments) ? (a.assignments as Array<{ block_id: number; client: string }>) : [];
      const byClient = new Map<string, number>();
      for (const x of list) byClient.set(x.client, (byClient.get(x.client) ?? 0) + 1);
      return { label: 'reclassificar', subject: [...byClient].map(([c, n]) => `${n} blocos → ${c}`).join(' · ') };
    },
    run: (a) => {
      const list = Array.isArray(a.assignments) ? (a.assignments as Array<{ block_id: number; client: string }>) : [];
      let n = 0;
      for (const x of list) {
        const cid = clientIdFrom(x.client);
        if (cid) {
          setBlockClient(Number(x.block_id), cid);
          n++;
        }
      }
      emit('stats:changed', todayStats());
      return { classified: n };
    },
  },
  {
    name: 'get_unread_emails',
    description: 'E-mails não lidos da caixa de entrada (Gmail, só leitura): remetente, assunto, trecho.',
    inputSchema: { type: 'object', properties: { max: { type: 'number' } } },
    run: async (a) => {
      if (!agentHooks.unreadEmails) return { connected: false, note: 'Gmail não conectado.' };
      return { connected: true, emails: await agentHooks.unreadEmails(Math.min(25, num(a.max) ?? 10)) };
    },
  },
  {
    name: 'get_patterns',
    description: 'Padrões das últimas semanas: o que é mais adiado, horários de mais foco, dias de mais distração.',
    inputSchema: { type: 'object', properties: { weeks: { type: 'number' } } },
    run: (a) => (agentHooks.patterns ? agentHooks.patterns(num(a.weeks) ?? 4) : []),
  },
];

/** Ferramentas registradas por outros módulos (construtor de Pipos, conversa com Pipos). */
export function registerTools(defs: ToolDef[]): void {
  for (const d of defs) {
    const i = TOOLS.findIndex((t) => t.name === d.name);
    if (i >= 0) TOOLS.splice(i, 1);
    TOOLS.push(d);
  }
}

const DEFAULT_MODES: Array<ToolCtx['mode']> = ['chat', 'capture', 'builder', 'pipo'];

function availableIn(t: ToolDef, mode: ToolCtx['mode']): boolean {
  return (t.modes ?? DEFAULT_MODES).includes(mode);
}

export function toolDescriptors(ctx?: ToolCtx): ToolDescriptor[] {
  return TOOLS.filter((t) => !ctx || availableIn(t, ctx.mode)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Nomes das ferramentas que alteram dados (para --allowedTools e para a UI). */
export function mutatingTools(): string[] {
  return TOOLS.filter((t) => t.confirm).map((t) => t.name);
}

export async function callTool(name: string, args: Args, ctx: ToolCtx): Promise<{ text: string; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Ferramenta desconhecida: ${name}`, isError: true };
  if (!availableIn(tool, ctx.mode)) return { text: `A ferramenta ${name} não está disponível nesta conversa.`, isError: true };
  try {
    const spec = tool.confirm?.(args, ctx);
    if (spec) {
      const ok = await confirmAction(name, spec);
      if (!ok) return { text: 'O usuário recusou esta ação. Não tente de novo sem ele pedir.', isError: false };
    }
    const out = await tool.run(args, ctx);
    return { text: JSON.stringify(out ?? { ok: true }), isError: false };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}
