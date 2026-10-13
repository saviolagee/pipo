import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDay, keyOf, ordered, stagesOf, type Goal, type GoalAction } from '@shared/trail';
import { Button } from '../components/Button';
import { TextField, usePinOnFocus } from '../components/Form';
import { IconCheck, IconChevron, IconPlus, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { askPipo, completeAction } from './actions';

const tt = t.trail;
const ROW = 50;
const HEAD = 30;
const ADD = 30;
/** Largura da coluna do caminho; o texto das ações começa logo depois. */
const COL = 128;
/** O caminho ondula como uma trilha: cada ação fica um pouco para o lado da anterior. */
const xOf = (i: number): number => 50 + Math.round(26 * Math.sin(i * 0.95));

type Item =
  | { kind: 'stage'; key: string; y: number; stage: string; done: number; total: number }
  | { kind: 'action'; key: string; y: number; action: GoalAction; index: number }
  | { kind: 'add'; key: string; y: number; stage: string; afterId: number };

function layout(goal: Goal): { items: Item[]; height: number } {
  const groups = stagesOf(goal.actions);
  const heads = groups.length > 1 || !!groups[0]?.stage;
  const items: Item[] = [];
  let y = 6;
  let index = 0;
  groups.forEach((g, gi) => {
    if (heads) {
      items.push({ kind: 'stage', key: `s${gi}`, y, stage: g.stage, done: g.actions.filter((a) => a.doneAt).length, total: g.actions.length });
      y += HEAD;
    }
    for (const a of g.actions) {
      items.push({ kind: 'action', key: `a${a.id}`, y, action: a, index: index++ });
      y += ROW;
    }
    items.push({ kind: 'add', key: `p${gi}`, y, stage: g.stage, afterId: g.actions[g.actions.length - 1].id });
    y += ADD;
  });
  return { items, height: y + 4 };
}

function IconLock(): React.JSX.Element {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

function IconPencil(): React.JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  );
}

function Tool({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] text-fg-3 transition-colors hover:bg-white/[0.08] hover:text-fg disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function DayField({ value, min, onChange }: { value: string; min: string; onChange: (v: string) => void }): React.JSX.Element {
  const pin = usePinOnFocus('trail-day');
  return (
    <input
      type="date"
      aria-label={tt.day}
      title={tt.day}
      value={value}
      min={min}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      {...pin}
      className="mono h-[28px] w-[128px] shrink-0 rounded-[9px] px-[8px] text-[12px] outline-none [color-scheme:dark] focus:ring-1 focus:ring-white/30"
      style={{ background: 'var(--bg-input)' }}
    />
  );
}

/** Linha em edição: texto, dia (só pendentes) e, nas concluídas, desfazer. */
function EditRow({ action, today, onClose }: { action: GoalAction; today: string; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(action.title);
  const [day, setDay] = useState(action.day);
  const save = async (): Promise<void> => {
    await api.invoke('goals:updateAction', action.id, { title, ...(action.doneAt || day === action.day ? {} : { day }) });
    onClose();
  };
  return (
    <div className="flex w-full items-center gap-[6px]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onClose())}>
      <TextField value={title} onChange={setTitle} onEnter={() => void save()} autoFocus className="h-[28px] min-w-0 flex-1 text-[12.5px]" pinKey="trail-edit" ariaLabel={tt.edit} />
      {action.doneAt ? (
        <Button
          size="sm"
          variant="tertiary"
          onClick={() => {
            void api.invoke('goals:setDone', action.id, false);
            onClose();
          }}
        >
          {tt.undo}
        </Button>
      ) : (
        <DayField value={day} min={today} onChange={setDay} />
      )}
      <Button size="sm" variant="primary" onClick={() => void save()}>
        {tt.save}
      </Button>
      <Tool label={tt.cancel} onClick={onClose}>
        <IconX size={11} />
      </Tool>
    </div>
  );
}

/** Campo de nova ação no fim de uma etapa. Fica aberto para adicionar várias seguidas. */
function AddRow({ goalId, stage, afterId, withStage }: { goalId: number; stage: string; afterId: number; withStage?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const add = async (): Promise<void> => {
    const title = text.trim();
    if (!title || (withStage && !name.trim())) return;
    setText('');
    await api.invoke('goals:addAction', goalId, { title, stage: withStage ? name.trim() : stage, afterId });
    if (withStage) setOpen(false);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex h-[22px] items-center gap-[5px] rounded-[7px] px-[6px] text-[11px] text-fg-3 hover:bg-white/[0.06] hover:text-fg">
        <IconPlus size={9} /> {withStage ? tt.addStage : tt.addAction}
      </button>
    );
  return (
    <div className="flex w-full items-center gap-[6px]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setOpen(false))}>
      {withStage && <TextField value={name} onChange={setName} onEnter={() => void add()} autoFocus placeholder={tt.addStagePh} className="h-[26px] w-[170px] text-[12px]" pinKey="trail-stage" />}
      <TextField value={text} onChange={setText} onEnter={() => void add()} autoFocus={!withStage} placeholder={tt.addActionPh} className="h-[26px] min-w-0 flex-1 text-[12px]" pinKey="trail-add" />
      <Tool label={tt.cancel} onClick={() => setOpen(false)}>
        <IconX size={11} />
      </Tool>
    </div>
  );
}

function StageHead({ goalId, stage, done, total }: { goalId: number; stage: string; done: number; total: number }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage);
  const save = async (): Promise<void> => {
    if (name.trim() !== stage) await api.invoke('goals:renameStage', goalId, stage, name);
    setEditing(false);
  };
  if (editing)
    return (
      <div className="flex items-center gap-[6px]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setEditing(false))}>
        <TextField value={name} onChange={setName} onEnter={() => void save()} autoFocus placeholder={tt.addStagePh} className="h-[24px] w-[240px] text-[12px]" pinKey="trail-stage-name" />
      </div>
    );
  return (
    <button type="button" title={tt.renameStage} onClick={() => setEditing(true)} className="flex items-baseline gap-[8px] text-left">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-2">{stage || tt.noStage}</span>
      <span className="mono text-[10px] text-fg-3">
        {done}/{total}
      </span>
    </button>
  );
}

export function TrailPath({ goal, today }: { goal: Goal; today: string }): React.JSX.Element {
  const { items, height } = useMemo(() => layout(goal), [goal]);
  const [editing, setEditing] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const actions = items.filter((i): i is Extract<Item, { kind: 'action' }> => i.kind === 'action');
  const pending = ordered(goal.actions).filter((a) => !a.doneAt);
  const current = pending[0] ?? null;
  const currentY = actions.find((i) => i.action.id === current?.id)?.y ?? null;
  const last = actions[actions.length - 1];

  // Ao abrir (ou trocar de plano), a ação da vez fica à vista. Só nessa hora: mexer na trilha não rola a tela.
  const currentYRef = useRef(currentY);
  currentYRef.current = currentY;
  useEffect(() => {
    if (currentYRef.current !== null) scrollRef.current?.scrollTo({ top: Math.max(0, currentYRef.current - 96) });
  }, [goal.id]);

  const move = (a: GoalAction, dir: -1 | 1): void => {
    const ids = pending.map((p) => p.id);
    const i = ids.indexOf(a.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void api.invoke('goals:reorder', goal.id, ids);
  };

  if (!goal.actions.length)
    return (
      <div className="flex flex-col gap-[10px] rounded-[16px] px-[16px] py-[18px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <p className="text-[12.5px] text-fg-2">{tt.emptyTrail}</p>
        <div className="flex items-center gap-[8px]">
          <AddRow goalId={goal.id} stage="" afterId={0} />
          <span className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => askPipo(tt.breakdownPrompt(goal.title, goal.outcome), true)}>
            {tt.breakdown}
          </Button>
        </div>
      </div>
    );

  return (
    <div ref={scrollRef} className="scroll-thin relative max-h-[292px] overflow-y-auto rounded-[16px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="relative" style={{ height }}>
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0" width={COL} height={height}>
          {actions.slice(0, -1).map((it, i) => {
            const next = actions[i + 1];
            const [x1, y1, x2, y2] = [xOf(it.index), it.y + ROW / 2, xOf(next.index), next.y + ROW / 2];
            const mid = (y1 + y2) / 2;
            const walked = !!it.action.doneAt;
            return <path key={it.key} d={`M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`} fill="none" stroke={walked ? 'var(--status-done)' : 'rgba(255,255,255,0.16)'} strokeOpacity={walked ? 0.55 : 1} strokeWidth={3} strokeLinecap="round" strokeDasharray={walked ? undefined : '1 8'} />;
          })}
        </svg>
        {items.map((it) => {
          if (it.kind === 'stage')
            return (
              <div key={it.key} className="absolute flex items-end pb-[4px]" style={{ top: it.y, left: 14, right: 12, height: HEAD }}>
                <StageHead goalId={goal.id} stage={it.stage} done={it.done} total={it.total} />
              </div>
            );
          if (it.kind === 'add')
            return (
              <div key={it.key} className="absolute flex items-center gap-[4px]" style={{ top: it.y, left: COL - 6, right: 12, height: ADD }}>
                <AddRow goalId={goal.id} stage={it.stage} afterId={it.afterId} />
                {it.afterId === last?.action.id && <AddRow goalId={goal.id} stage="" afterId={it.afterId} withStage />}
              </div>
            );
          const a = it.action;
          const isCurrent = a.id === current?.id;
          const due = isCurrent && a.day <= today;
          const r = isCurrent ? 19 : 14;
          const pi = pending.findIndex((p) => p.id === a.id);
          return (
            <div key={it.key} className="group absolute left-0 right-0" style={{ top: it.y, height: ROW }}>
              <div className="absolute" style={{ left: xOf(it.index) - r, top: ROW / 2 - r, width: r * 2, height: r * 2 }}>
                {isCurrent && due && <motion.span aria-hidden className="absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 3px rgba(96,165,250,0.6)' }} animate={{ scale: [1, 1.28, 1], opacity: [0.9, 0, 0.9] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />}
                <button
                  type="button"
                  aria-label={a.doneAt ? tt.doneOn(fmtDay(keyOf(new Date(a.doneAt)), today)) : isCurrent ? `${tt.complete}: ${a.title}` : tt.locked}
                  title={a.doneAt ? tt.edit : isCurrent ? tt.complete : tt.locked}
                  onClick={() => (isCurrent ? void completeAction(a) : a.doneAt ? setEditing(a.id) : undefined)}
                  className={`relative flex h-full w-full items-center justify-center rounded-full transition-transform ${isCurrent ? 'hover:scale-[1.06]' : ''}`}
                  style={
                    a.doneAt
                      ? { background: 'var(--status-done)', color: '#000' }
                      : isCurrent
                        ? { background: '#fff', color: '#000', boxShadow: due ? '0 0 0 3px rgba(96,165,250,0.55), 0 0 18px rgba(59,130,246,0.5)' : '0 0 0 3px rgba(255,255,255,0.14)' }
                        : { background: '#1c1c20', color: 'rgba(255,255,255,0.32)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)', cursor: 'default' }
                  }
                >
                  {a.doneAt || isCurrent ? <IconCheck size={isCurrent ? 15 : 12} strokeWidth={3} /> : <IconLock />}
                </button>
              </div>
              <div className="absolute flex items-center gap-[8px]" style={{ left: COL, right: 12, top: 0, height: ROW }}>
                {editing === a.id ? (
                  <EditRow action={a} today={today} onClose={() => setEditing(null)} />
                ) : (
                  <>
                    <button type="button" className="min-w-0 flex-1 text-left" onDoubleClick={() => setEditing(a.id)} title={a.notes || a.title}>
                      <span className={`block truncate text-[13px] ${a.doneAt ? 'text-fg-3' : isCurrent ? 'font-medium text-fg' : 'text-fg-2'}`}>{a.title}</span>
                      <span className="block truncate text-[11px] text-fg-3">
                        {a.doneAt ? tt.doneOn(fmtDay(keyOf(new Date(a.doneAt)), today)) : <span style={due ? { color: '#60A5FA', fontWeight: 500 } : undefined}>{due ? tt.homeToday : fmtDay(a.day, today)}</span>}
                        {a.notes ? ` · ${a.notes}` : ''}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-[1px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      {!a.doneAt && (
                        <>
                          <Tool label={tt.up} disabled={pi <= 0} onClick={() => move(a, -1)}>
                            <IconChevron size={11} dir="up" />
                          </Tool>
                          <Tool label={tt.down} disabled={pi < 0 || pi >= pending.length - 1} onClick={() => move(a, 1)}>
                            <IconChevron size={11} dir="down" />
                          </Tool>
                        </>
                      )}
                      <Tool label={tt.edit} onClick={() => setEditing(a.id)}>
                        <IconPencil />
                      </Tool>
                      <Tool label={tt.remove} onClick={() => void api.invoke('goals:deleteAction', a.id)}>
                        <IconX size={11} />
                      </Tool>
                    </span>
                    {isCurrent && (
                      <Button size="sm" variant="primary" onClick={() => void completeAction(a)}>
                        {tt.complete}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
