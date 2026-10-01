import { AnimatePresence, motion } from 'motion/react';
import type { Accessory, FocusState, MascotState } from '@shared/types';
import { IconArrowUpRight, IconCheck, IconChevron, IconPause, IconPlay, IconStop } from '../components/Icons';
import { IntegrationGrid } from '../components/IntegrationGrid';
import { t } from '../i18n/pt-BR';
import { api, fmtTimer } from '../lib/api';
import { Mascot, type Badge } from '../mascot/Mascot';
import { cardTint } from '../notch/Glow';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { celebrateTask } from './Tasks';

const f = t.focus;

interface Props {
  focus: FocusState;
  state: MascotState;
  badge: Badge;
  mood: number;
  accessories: Accessory[];
  onMascotClick: (e: React.MouseEvent) => void;
  bump: number;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-white/[0.08] hover:text-fg">
      {children}
    </button>
  );
}

/** Início com foco ativo: card da sessão + chips de integração [Ref 3, 5]. */
export function FocusCard({ focus, state, badge, mood, accessories, onMascotClick, bump }: Props): React.JSX.Element {
  const task = useData((s) => s.tasks.find((x) => x.id === focus.taskId));
  const subs = task?.subtasks ?? [];
  const doneCount = subs.filter((s) => s.done).length;
  const current = subs.find((s) => !s.done) ?? null;
  const lastDone = [...subs].reverse().find((s) => s.done) ?? null;
  const onBreak = focus.phase === 'break' || focus.phase === 'longBreak';

  const advance = async (): Promise<void> => {
    if (!current) return;
    await api.invoke('subtasks:toggle', current.id, true);
    useUi.getState().react('happy', 700);
    if (doneCount + 1 === subs.length && task) celebrateTask();
  };

  return (
    <div className="flex gap-[8px] px-[10px] pb-[10px]">
      <div className="flex min-w-0 flex-1 items-center gap-[14px] rounded-[16px] px-[14px] py-[12px]" style={{ ...cardTint(onBreak ? 'none' : 'none'), border: '1px solid var(--border-subtle)' }}>
        <div className="flex w-[84px] shrink-0 justify-center">
          <Mascot state={state} badge={badge} mood={mood} accessories={accessories} size={70} onClick={onMascotClick} bump={bump} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px] text-[12px]">
            <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: onBreak ? 'var(--status-done)' : '#F4F4F5' }} />
            <span className="shrink-0 font-semibold">{onBreak ? (focus.phase === 'longBreak' ? f.longBreak : f.break) : f.label}</span>
            <span className="min-w-0 truncate text-fg-2">{focus.taskTitle}</span>
            <span className="flex-1" />
            {subs.length > 0 && (
              <span className="mono shrink-0 text-[11px] text-fg-3">
                {doneCount}/{subs.length}
              </span>
            )}
            {task && (
              <IconBtn label={t.tabs.tasks} onClick={() => useUi.getState().setTab('tasks')}>
                <IconArrowUpRight size={11} />
              </IconBtn>
            )}
          </div>
          <div className="mt-[6px] flex min-h-[38px] flex-col justify-center gap-[3px]">
            <AnimatePresence initial={false} mode="popLayout">
              {lastDone && (
                <motion.div key={`d${lastDone.id}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex items-center gap-[6px] text-[11.5px] text-fg-3">
                  <IconCheck size={10} />
                  <span className="truncate">{lastDone.title}</span>
                </motion.div>
              )}
              {current ? (
                <motion.button
                  key={`c${current.id}`}
                  layout
                  type="button"
                  onClick={() => void advance()}
                  title="Marcar como feita"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="flex items-center gap-[6px] text-left text-[13px] text-fg hover:text-white"
                >
                  <IconChevron size={10} />
                  <span className="truncate">
                    {f.doing} · {current.title}
                  </span>
                </motion.button>
              ) : (
                focus.microStep && (
                  <div className="flex items-center gap-[6px] text-[13px] text-fg">
                    <IconChevron size={10} />
                    <span className="truncate">
                      {f.microStep} · {focus.microStep}
                    </span>
                  </div>
                )
              )}
            </AnimatePresence>
          </div>
          <div className="mt-[6px] flex items-center gap-[10px]">
            <span className="mono text-[20px] font-medium leading-none" style={{ color: onBreak ? 'var(--status-done)' : 'var(--text-primary)' }}>
              {fmtTimer(focus.remainingSec)}
            </span>
            <span className="text-[11.5px] text-fg-3">{f.cycle(Math.min(focus.cycle, focus.totalCycles), focus.totalCycles)}</span>
            <span className="flex-1" />
            {focus.paused ? (
              <IconBtn label={f.resume} onClick={() => void api.invoke('focus:resume')}>
                <IconPlay size={10} />
              </IconBtn>
            ) : (
              <IconBtn label={f.pause} onClick={() => void api.invoke('focus:pause')}>
                <IconPause size={10} />
              </IconBtn>
            )}
            <IconBtn label={f.stop} onClick={() => void api.invoke('focus:stop', false)}>
              <IconStop size={9} />
            </IconBtn>
          </div>
        </div>
      </div>
      <div className="w-[236px] shrink-0 rounded-[16px] p-[8px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <IntegrationGrid />
      </div>
    </div>
  );
}
