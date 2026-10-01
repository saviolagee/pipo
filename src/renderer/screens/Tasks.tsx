import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client, ParsedCapture, Task } from '@shared/types';
import { Button } from '../components/Button';
import { usePinOnFocus } from '../components/Form';
import { IconChevron, IconGrip, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api, fmtDue, fmtHM } from '../lib/api';
import { play } from '../sound/sfx';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

const tt = t.tasks;

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}

const CHEERS = ['Boa! Uma a menos.', 'Mandou bem!', 'Feito ✓', 'Isso aí!'];

export function celebrateTask(): void {
  const ui = useUi.getState();
  ui.react('happy', 900);
  ui.confetti(8);
  ui.say(CHEERS[Math.floor(Math.random() * CHEERS.length)], 2500);
  play('chime');
}

export async function toggleComplete(task: Task, done: boolean): Promise<void> {
  await api.invoke('tasks:complete', task.id, done);
  if (done) celebrateTask();
}

function Check({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
      style={{ boxShadow: done ? 'none' : 'inset 0 0 0 1.5px rgba(255,255,255,0.35)', background: done ? 'var(--status-done)' : 'transparent' }}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" aria-hidden>
        <motion.path d="m5 12.5 4.5 4.5L19 7.5" stroke="#000" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" initial={false} animate={{ pathLength: done ? 1 : 0 }} transition={{ duration: 0.25 }} />
      </svg>
    </button>
  );
}

function Dots({ p }: { p: number }): React.JSX.Element {
  return (
    <span className="flex gap-[2px]" aria-label={`prioridade ${p}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className="h-[4px] w-[4px] rounded-full" style={{ background: i <= p ? (p === 3 ? 'var(--status-attention)' : '#D4D4D8') : 'rgba(255,255,255,0.12)' }} />
      ))}
    </span>
  );
}

function Meta({ task, client }: { task: Task; client: Client | undefined }): React.JSX.Element {
  const overdue = task.dueAt && Date.parse(task.dueAt) < Date.now() && task.status !== 'done';
  return (
    <span className="flex shrink-0 items-center gap-[8px] text-[11px] text-fg-3">
      {client && (
        <span className="rounded-[6px] px-[6px] py-[1px] text-[11px]" style={{ background: `${client.color}22`, color: client.color }}>
          {client.name}
        </span>
      )}
      {task.subtasks.length > 0 && (
        <span className="mono">
          {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
        </span>
      )}
      {task.estimateMin ? <span>~{fmtHM(task.estimateMin)}</span> : null}
      {task.dueAt && <span style={{ color: overdue ? 'var(--status-attention)' : undefined }}>{fmtDue(task.dueAt)}</span>}
      <Dots p={task.priority} />
    </span>
  );
}

function TaskDetail({ task }: { task: Task }): React.JSX.Element {
  const [notes, setNotes] = useState(task.notes);
  const [sub, setSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const claudeOk = useData((s) => s.claude.state === 'ok');
  const pin = usePinOnFocus(`task-${task.id}`);

  const addSub = async (): Promise<void> => {
    if (!sub.trim()) return;
    await api.invoke('subtasks:add', task.id, [sub.trim()]);
    setSub('');
  };

  const breakDown = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.invoke('agent:send', { conversationId: null, text: `Quebra a tarefa #${task.id} "${task.title}" em 3 a 5 passos concretos e adiciona como subtarefas.` });
      useUi.getState().setTab('chat');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="flex flex-col gap-[8px] pb-[10px] pl-[28px] pr-[6px] pt-[4px]">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            pin.onBlur();
            if (notes !== task.notes) void api.invoke('tasks:update', task.id, { notes });
          }}
          onFocus={pin.onFocus}
          placeholder={tt.notes}
          rows={2}
          className="scroll-thin w-full resize-none rounded-[8px] px-[10px] py-[6px] text-[12px] outline-none placeholder:text-fg-3"
          style={{ background: 'var(--bg-input)' }}
        />
        {task.subtasks.map((s) => (
          <div key={s.id} className="group flex items-center gap-[8px] text-[12px]">
            <Check done={s.done} label={s.title} onToggle={() => void api.invoke('subtasks:toggle', s.id, !s.done)} />
            <span className={s.done ? 'text-fg-3 line-through' : 'text-fg'}>{s.title}</span>
            <button type="button" aria-label={`${t.common.remove} ${s.title}`} className="ml-auto opacity-0 group-hover:opacity-100" onClick={() => void api.invoke('subtasks:delete', s.id)}>
              <IconX size={10} />
            </button>
          </div>
        ))}
        <input
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addSub()}
          {...pin}
          placeholder={tt.addSubtask}
          className="h-[26px] rounded-[8px] px-[10px] text-[12px] outline-none placeholder:text-fg-3"
          style={{ background: 'var(--bg-input)' }}
        />
        <div className="flex flex-wrap items-center gap-[6px]">
          <Button size="sm" variant="primary" onClick={() => void api.invoke('focus:start', { taskId: task.id }).then(() => useUi.getState().setTab('home'))}>
            {tt.focusThis}
          </Button>
          <Button size="sm" onClick={() => void breakDown()} disabled={busy || !claudeOk} title={claudeOk ? undefined : tt.needsClaude}>
            {tt.breakDown}
          </Button>
          {!task.isToday && (
            <Button size="sm" variant="tertiary" onClick={() => void api.invoke('tasks:update', task.id, { isToday: true })}>
              {tt.moveToday}
            </Button>
          )}
          {task.isToday && (
            <Button size="sm" variant="tertiary" onClick={() => void api.invoke('tasks:update', task.id, { isToday: false })}>
              {tt.removeToday}
            </Button>
          )}
          <Button size="sm" variant="tertiary" onClick={() => void api.invoke('tasks:delete', task.id)}>
            {t.common.remove}
          </Button>
        </div>
        {err && <p className="text-[11px] text-attention">{err}</p>}
      </div>
    </motion.div>
  );
}

function TaskRow({ task, client, open, onOpen, draggable }: { task: Task; client: Client | undefined; open: boolean; onOpen: () => void; draggable?: boolean }): React.JSX.Element {
  const controls = useDragControls();
  const done = task.status === 'done';
  const body = (
    <div className="rounded-[10px] transition-colors hover:bg-white/[0.03]" style={{ background: open ? 'rgba(255,255,255,0.04)' : undefined }}>
      <div className="flex h-[34px] cursor-default items-center gap-[10px] px-[6px]" onClick={onOpen}>
        {draggable && (
          <span className="cursor-grab text-fg-3 opacity-40 hover:opacity-100" onPointerDown={(e) => controls.start(e)} aria-hidden>
            <IconGrip size={10} />
          </span>
        )}
        <Check done={done} label={`${done ? tt.reopen : tt.complete}: ${task.title}`} onToggle={() => void toggleComplete(task, !done)} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${done ? 'text-fg-3 line-through' : 'text-fg'}`}>
          {task.status === 'doing' && <span className="mr-[6px] inline-block h-[6px] w-[6px] rounded-full bg-working align-middle" />}
          {task.title}
        </span>
        <Meta task={task} client={client} />
      </div>
      <AnimatePresence initial={false}>{open && <TaskDetail task={task} />}</AnimatePresence>
    </div>
  );
  if (!draggable) return body;
  return (
    <Reorder.Item value={task} dragListener={false} dragControls={controls} as="div" onDragEnd={() => undefined}>
      {body}
    </Reorder.Item>
  );
}

function Section({ title, count, children, collapsed, onToggle }: { title: string; count: number; children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }): React.JSX.Element | null {
  if (count === 0 && !onToggle) return null;
  return (
    <div className="mb-[6px]">
      <button type="button" onClick={onToggle} className="flex items-center gap-[6px] px-[6px] py-[4px] text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">
        {onToggle && <IconChevron size={9} dir={collapsed ? 'right' : 'down'} />}
        {title}
        <span className="mono normal-case">{count}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

function QuickAdd(): React.JSX.Element {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedCapture | null>(null);
  const clients = useData((s) => s.clients);
  const pin = usePinOnFocus('newtask');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!text.trim()) return setPreview(null);
    const id = setTimeout(() => void api.invoke('tasks:parse', text).then(setPreview), 120);
    return () => clearTimeout(id);
  }, [text]);

  const submit = async (): Promise<void> => {
    if (!text.trim()) return;
    const p = await api.invoke('tasks:parse', text);
    await api.invoke('tasks:create', { title: p.title, dueAt: p.dueAt, estimateMin: p.estimateMin, clientId: p.clientId, priority: p.priority, isToday: !p.dueAt || undefined, source: 'manual' });
    setText('');
    play('tick');
  };

  const client = preview?.clientId ? clients.find((c) => c.id === preview.clientId) : undefined;
  return (
    <div className="px-[10px] pb-[6px]">
      <input
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        {...pin}
        placeholder={tt.newPlaceholder}
        aria-label={tt.newPlaceholder}
        className="h-[34px] w-full rounded-full px-[14px] text-[13px] outline-none placeholder:text-fg-3 focus:ring-1 focus:ring-white/20"
        style={{ background: 'var(--bg-input)' }}
      />
      <AnimatePresence>
        {preview && (preview.dueAt || preview.estimateMin || client) && (
          <motion.div initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-[8px] px-[14px] pt-[4px] text-[11px] text-fg-2">
            <span className="text-fg">{preview.title}</span>
            {preview.dueAt && <span>📅 {fmtDue(preview.dueAt)}</span>}
            {preview.estimateMin && <span>⏱ ~{fmtHM(preview.estimateMin)}</span>}
            {client && <span style={{ color: client.color }}>#{client.name}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Aba de tarefas (seção 8.3). */
export function TasksScreen({ focusTaskId }: { focusTaskId?: number | null }): React.JSX.Element {
  const tasks = useData((s) => s.tasks);
  const clients = useData((s) => s.clients);
  const stats = useData((s) => s.stats);
  const [open, setOpen] = useState<number | null>(focusTaskId ?? null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [order, setOrder] = useState<Task[]>([]);

  const now = new Date();
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const sections = useMemo(() => {
    const openTasks = tasks.filter((x) => x.status !== 'done');
    const today = openTasks.filter((x) => x.isToday || (x.dueAt && Date.parse(x.dueAt) < endToday)).sort((a, b) => a.position - b.position);
    const upcoming = openTasks.filter((x) => !today.includes(x) && x.dueAt).sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string));
    const someday = openTasks.filter((x) => !today.includes(x) && !x.dueAt);
    const doneToday = tasks.filter((x) => x.status === 'done');
    return { today, upcoming, someday, doneToday };
  }, [tasks, endToday]);

  useEffect(() => setOrder(sections.today), [sections.today]);

  const clientOf = (task: Task): Client | undefined => clients.find((c) => c.id === task.clientId);
  const toggle = (id: number): void => setOpen((v) => (v === id ? null : id));

  const planned = stats?.plannedMin ?? 0;
  const goal = stats?.goalMin ?? 0;
  const meetings = stats?.meetingMin ?? 0;
  const over = planned + meetings > goal && goal > 0;

  return (
    <div className="flex h-[372px] flex-col">
      <QuickAdd />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[10px]">
        <Section title={tt.today} count={order.length}>
          <Reorder.Group axis="y" values={order} onReorder={setOrder} as="div" onPointerUp={() => void api.invoke('tasks:reorder', order.map((x) => x.id))}>
            {order.map((task) => (
              <TaskRow key={task.id} task={task} client={clientOf(task)} open={open === task.id} onOpen={() => toggle(task.id)} draggable />
            ))}
          </Reorder.Group>
          {order.length === 0 && <p className="px-[6px] py-[6px] text-[12px] text-fg-3">{t.home.noTasks}</p>}
        </Section>
        <Section title={tt.upcoming} count={sections.upcoming.length}>
          {sections.upcoming.map((task) => (
            <TaskRow key={task.id} task={task} client={clientOf(task)} open={open === task.id} onOpen={() => toggle(task.id)} />
          ))}
        </Section>
        <Section title={tt.someday} count={sections.someday.length}>
          {sections.someday.map((task) => (
            <TaskRow key={task.id} task={task} client={clientOf(task)} open={open === task.id} onOpen={() => toggle(task.id)} />
          ))}
        </Section>
        <Section title={tt.doneToday} count={sections.doneToday.length} collapsed={!doneOpen} onToggle={() => setDoneOpen((v) => !v)}>
          {sections.doneToday.map((task) => (
            <TaskRow key={task.id} task={task} client={clientOf(task)} open={false} onOpen={() => undefined} />
          ))}
        </Section>
      </div>
      <div className="flex h-[30px] items-center gap-[6px] border-t px-[16px] text-[11.5px]" style={{ borderColor: 'var(--border-subtle)', color: over ? 'var(--status-attention)' : 'var(--text-secondary)' }}>
        {tt.footer(fmtHM(planned), fmtHM(goal), fmtHM(meetings))}
        {over && <span>· {tt.overGoal}</span>}
      </div>
    </div>
  );
}

