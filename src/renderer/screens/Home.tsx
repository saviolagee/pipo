import { motion } from 'motion/react';
import type { Accessory, MascotState } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { fmtHM, fmtTime } from '../lib/api';
import { Mascot, type Badge } from '../mascot/Mascot';
import { useData } from '../store/data';
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
          {entrance ?? (
            <Mascot state={state} badge={badge} mood={mood} accessories={accessories} size={76} look={look} bump={bump} onClick={onMascotClick} />
          )}
        </div>
        {phrase && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="relative mt-[2px] text-[13px] text-fg">
            {paused ? t.home.paused : phrase}
          </motion.p>
        )}
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
