import { AnimatePresence, motion } from 'motion/react';
import type { Accessory, MascotState } from '@shared/types';
import { INTEGRATION_COLORS, MiniFace } from '../components/MiniFace';
import { useIntegrationFlags } from '../components/IntegrationGrid';
import { fmtHM, fmtTimer } from '../lib/api';
import { Mascot, type Badge } from '../mascot/Mascot';
import { useData } from '../store/data';
import { GoalRing } from './GoalRing';

interface Props {
  state: MascotState;
  badge: Badge;
  mood: number;
  accessories: Accessory[];
  clipboardCandidate: React.ReactNode;
}

/** Pílula colapsada ~340×32 [Ref 7]. */
export function Pill({ state, badge, mood, accessories, clipboardCandidate }: Props): React.JSX.Element {
  const focus = useData((s) => s.focus);
  const stats = useData((s) => s.stats);
  const flags = useIntegrationFlags();
  const progress = stats && stats.goalMin > 0 ? stats.workedMin / stats.goalMin : 0;
  const statusDot = badge === 'attention' ? '#F59E0B' : badge === 'done' ? '#22C55E' : focus?.phase === 'focus' ? '#3B82F6' : null;

  return (
    <div className="flex h-full w-full items-center justify-between px-[12px]">
      <div className="relative flex h-full w-[48px] items-center">
        <div className="relative -my-2">
          <Mascot state={state} mood={mood} size={22} accessories={accessories.filter((a) => a !== 'coffee')} glow={false} still={state === 'idle'} />
          {statusDot && <span className="absolute left-[2px] top-[5px] h-[6px] w-[6px] rounded-full" style={{ background: statusDot, boxShadow: '0 0 0 1.5px #000' }} />}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <AnimatePresence mode="wait">
          {clipboardCandidate ? (
            <motion.div key="clip" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {clipboardCandidate}
            </motion.div>
          ) : focus ? (
            <motion.span
              key="timer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mono text-[13px] font-medium"
              style={{ color: focus.phase === 'focus' ? '#F4F4F5' : 'var(--status-done)' }}
            >
              {fmtTimer(focus.remainingSec)}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex w-[48px] items-center justify-end gap-[8px]">
        <GoalRing progress={progress} size={16} title={stats ? `${fmtHM(stats.workedMin)} de ${fmtHM(stats.goalMin)}` : undefined} />
        <div className="grid grid-cols-2 gap-[2px]">
          <MiniFace color={INTEGRATION_COLORS.google_calendar} size={9} dim={!flags.google_calendar} />
          <MiniFace color={INTEGRATION_COLORS.gmail} size={9} dim={!flags.gmail} />
          <MiniFace color={INTEGRATION_COLORS.spotify} size={9} dim={!flags.spotify} />
          <MiniFace color={INTEGRATION_COLORS.claude} size={9} dim={!flags.claude} />
        </div>
      </div>
    </div>
  );
}
