import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTCH } from '@shared/config';
import type { GlowKind } from '@shared/types';
import { api } from '../lib/api';
import { isPinned, useUi } from '../store/ui';
import { Glow } from './Glow';

const SPRING = { type: 'spring', stiffness: 400, damping: 32 } as const;

interface Props {
  glow: GlowKind;
  pill: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  /** Altura fixa do conteúdo expandido (ex.: chat ~420px); senão, mede o conteúdo. */
  fixedHeight?: number | null;
  onHoverChange?: (hovered: boolean) => void;
  onDragEnter?: (e: React.DragEvent) => void;
}

/** A ilha preta: alterna entre pill e notch expandido com mola elástica (seção 5.5). */
export function Notch({ glow, pill, topBar, children, fixedHeight, onHoverChange, onDragEnter }: Props): React.JSX.Element {
  const expanded = useUi((s) => s.expanded);
  const pins = useUi((s) => s.pins);
  const setExpanded = useUi((s) => s.setExpanded);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(220);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inside = useRef(false);
  const pinned = isPinned(pins);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.offsetHeight));
    ro.observe(el);
    setContentH(el.offsetHeight);
    return () => ro.disconnect();
  }, [expanded]);

  const clearTimers = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    hoverTimer.current = null;
    leaveTimer.current = null;
  };

  // Colapsa ao sair o mouse por 1.5s (exceto quando algo prende o notch aberto).
  useEffect(() => {
    if (!expanded || pinned || inside.current) return;
    leaveTimer.current = setTimeout(() => setExpanded(false), NOTCH.leaveCollapseMs);
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, [expanded, pinned, setExpanded]);

  // Clique fora (a janela perde o foco) ou Esc colapsam.
  useEffect(() => {
    const onBlur = (): void => {
      if (!isPinned(useUi.getState().pins)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) setExpanded(false);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
    };
  }, [setExpanded]);

  useEffect(() => {
    api.send('ui:expandedChanged', expanded);
  }, [expanded]);

  const onEnter = (): void => {
    inside.current = true;
    clearTimers();
    void api.invoke('window:setInteractive', true);
    onHoverChange?.(true);
    if (!expanded) hoverTimer.current = setTimeout(() => setExpanded(true), NOTCH.hoverExpandMs);
  };

  const onLeave = (): void => {
    inside.current = false;
    clearTimers();
    void api.invoke('window:setInteractive', false);
    onHoverChange?.(false);
    if (expanded && !isPinned(useUi.getState().pins)) {
      leaveTimer.current = setTimeout(() => setExpanded(false), NOTCH.leaveCollapseMs);
    }
  };

  const width = expanded ? NOTCH.expandedWidth : NOTCH.pillWidth;
  const height = expanded ? NOTCH.topBarHeight + (fixedHeight ?? contentH) : NOTCH.pillHeight;
  const radius = expanded ? 24 : 14;

  return (
    <div className="pointer-events-none relative flex h-full w-full justify-center">
      <Glow kind={glow} width={width} height={height} />
      <motion.div
        role="region"
        aria-label="Pipo"
        className="pointer-events-auto relative overflow-hidden"
        initial={false}
        animate={{ width, height, borderBottomLeftRadius: radius, borderBottomRightRadius: radius }}
        transition={SPRING}
        style={{ background: 'var(--bg-notch)', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={() => {
          if (!expanded) {
            clearTimers();
            setExpanded(true);
          }
        }}
        onDragEnter={onDragEnter}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {expanded ? (
            <motion.div
              key="expanded"
              className="absolute left-1/2 top-0"
              style={{ width: NOTCH.expandedWidth, x: '-50%' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.06, duration: 0.22 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              {topBar}
              <div ref={contentRef} style={fixedHeight ? { height: fixedHeight } : undefined}>
                {children}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="pill"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.08, duration: 0.18 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              {pill}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
