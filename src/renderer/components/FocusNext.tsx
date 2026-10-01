import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Task } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { focusNext, useFocusMinutes, useNextTask } from '../lib/focus';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { IconChevron, IconPlay } from './Icons';

const DURATIONS = [25, 50, 90];

/** Botão principal do Início: "▶ Focar: <tarefa> · 25 min", com setinha para trocar tarefa/duração. */
export function FocusNextButton(): React.JSX.Element {
  const next = useNextTask();
  const defaultMin = useFocusMinutes();
  const tasks = useData((s) => s.tasks);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const min = minutes ?? defaultMin;

  // A escolha prende o notch aberto e fecha ao clicar fora.
  useEffect(() => {
    useUi.getState().pin('focusPicker', open);
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => () => useUi.getState().pin('focusPicker', false), []);

  const options: Task[] = (() => {
    const openTasks = tasks.filter((x) => x.status !== 'done');
    const rest = openTasks.filter((x) => x.id !== next?.id).sort((a, b) => Number(b.isToday) - Number(a.isToday) || a.position - b.position);
    return (next ? [next, ...rest] : rest).slice(0, 6);
  })();

  const go = (taskId?: number): void => {
    setOpen(false);
    void focusNext(taskId ?? next?.id ?? null, minutes ?? undefined);
  };

  return (
    <div ref={box} className="relative flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => go()}
        aria-label={next ? t.focusNext.labelWith(next.title, min) : t.home.startFocus}
        className="inline-flex h-[30px] min-w-0 items-center gap-[7px] rounded-l-full bg-white pl-[12px] pr-[10px] text-[13px] font-medium text-black transition-colors hover:bg-white/90"
      >
        <IconPlay size={10} />
        {next ? (
          <>
            <span className="shrink-0">{t.focusNext.prefix}</span>
            <span className="min-w-0 max-w-[210px] truncate">{next.title}</span>
            <span className="mono shrink-0 text-[12px] text-black/55">· {min} min</span>
          </>
        ) : (
          <span>{t.home.startFocus}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={t.focusNext.choose}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="ml-px inline-flex h-[30px] w-[26px] items-center justify-center rounded-r-full bg-white text-black transition-colors hover:bg-white/90"
      >
        <IconChevron size={9} dir={open ? 'up' : 'down'} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            role="menu"
            className="absolute bottom-[calc(100%+6px)] right-0 z-20 w-[300px] rounded-[12px] p-[6px]"
            style={{ background: '#161618', border: '1px solid var(--border-subtle)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
          >
            <div className="flex items-center gap-[4px] px-[6px] pb-[6px] pt-[2px]">
              <span className="mr-auto text-[11px] text-fg-3">{t.focusNext.duration}</span>
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMinutes(d)}
                  className="mono rounded-full px-[8px] py-[2px] text-[11px]"
                  style={{ background: d === min ? '#fff' : 'rgba(255,255,255,0.08)', color: d === min ? '#000' : 'var(--text-secondary)' }}
                >
                  {d}
                </button>
              ))}
            </div>
            {options.length === 0 && <p className="px-[8px] py-[6px] text-[12px] text-fg-3">{t.home.noTasks}</p>}
            {options.map((task, i) => (
              <button
                key={task.id}
                type="button"
                role="menuitem"
                onClick={() => go(task.id)}
                className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[6px] text-left text-[12.5px] text-fg hover:bg-white/[0.06]"
              >
                <IconPlay size={8} />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {i === 0 && next?.id === task.id && <span className="text-[10.5px] text-fg-3">{t.focusNext.suggested}</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
