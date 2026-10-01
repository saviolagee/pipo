import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Accessory, MascotState } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { fmtHM, fmtTime } from '../lib/api';
import { Mascot, type Badge } from '../mascot/Mascot';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { Stars } from '../notch/Stars';

interface Props {
  state: MascotState;
  badge: Badge;
  mood: number;
  accessories: Accessory[];
  look: { x: number; y: number } | null;
  bump: number;
  onMascotClick: (e: React.MouseEvent) => void;
  onStartFocus: () => void;
  entrance: React.ReactNode;
}

/** Arrastar o mascote: ele estica na direção do arraste e volta com mola (seção 6.7). */
function DraggableMascot(props: React.ComponentProps<typeof Mascot>): React.JSX.Element {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scaleX = useTransform([x, y], ([vx, vy]: number[]) => 1 + Math.min(0.35, Math.abs(vx) / 160) - Math.min(0.15, Math.abs(vy) / 300));
  const scaleY = useTransform([x, y], ([vx, vy]: number[]) => 1 + Math.min(0.35, Math.abs(vy) / 160) - Math.min(0.15, Math.abs(vx) / 300));
  return (
    <motion.div
      drag
      dragSnapToOrigin
      dragElastic={0.18}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragTransition={{ bounceStiffness: 500, bounceDamping: 14 }}
      style={{ x, y, scaleX, scaleY }}
    >
      <Mascot {...props} />
    </motion.div>
  );
}

/** Fala do Pipo: uma linha, sem balão (seção 6.7). */
export function Speech(): React.JSX.Element {
  const speech = useUi((s) => s.speech);
  const [, force] = useState(0);
  useEffect(() => {
    if (!speech) return;
    const id = setTimeout(() => force((n) => n + 1), Math.max(0, speech.until - Date.now()) + 20);
    return () => clearTimeout(id);
  }, [speech]);
  const visible = speech && speech.until > Date.now();
  return (
    <AnimatePresence>
      {visible && (
        <motion.span key={speech.text} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="max-w-[220px] truncate whitespace-nowrap text-[12px] text-fg">
          {speech.text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Início sem foco ativo [Ref 1]. */
export function Home({ state, badge, mood, accessories, look, bump, onMascotClick, onStartFocus, entrance }: Props): React.JSX.Element {
  const stats = useData((s) => s.stats);
  const phrase = useData((s) => s.mood.phrase);
  const paused = useData((s) => s.settings?.paused ?? false);

  const parts: string[] = [];
  if (stats) {
    parts.push(t.home.hoursOf(fmtHM(stats.workedMin), fmtHM(stats.goalMin)));
    parts.push(t.home.tasksCount(stats.openTodayTasks));
    if (stats.nextMeeting) parts.push(t.home.nextMeeting(fmtTime(stats.nextMeeting.start)));
  }

  return (
    <div className="px-[10px] pb-[10px]">
      <div
        className="relative flex h-[188px] flex-col items-center justify-center overflow-hidden rounded-[16px]"
        style={{ background: 'linear-gradient(180deg, #0B0B0D 0%, #08080A 100%)', border: '1px solid var(--border-subtle)' }}
      >
        <Stars />
        <div className="relative flex h-[110px] items-center justify-center">
          {entrance ?? <DraggableMascot state={state} badge={badge} mood={mood} accessories={accessories} size={76} look={look} bump={bump} onClick={onMascotClick} />}
          <div className="absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2">
            <Speech />
          </div>
        </div>
        <motion.p key={paused ? 'p' : phrase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="relative mt-[2px] h-[18px] text-[13px] text-fg">
          {paused ? t.home.paused : phrase}
        </motion.p>
      </div>
      <div className="mt-[10px] flex items-center justify-between gap-3 px-[4px]">
        <span className="truncate text-[12px] text-fg-2">{parts.join(' · ')}</span>
        <Button variant="primary" onClick={onStartFocus} aria-label={t.home.startFocus}>
          {t.home.startFocus}
        </Button>
      </div>
    </div>
  );
}
