import { AnimatePresence, motion } from 'motion/react';
import type { Accessory, MascotState } from '@shared/types';
import { INTEGRATION_COLORS, MiniFace } from '../components/MiniFace';
import { useIntegrationFlags } from '../components/IntegrationGrid';
import { fmtHM, fmtTimer } from '../lib/api';
import { fmtMoney } from '@shared/format';
import { focusNext } from '../lib/focus';
import { t } from '../i18n/pt-BR';
import { IconPlay } from '../components/Icons';
import { PIPO_COLORS } from '@shared/pipos';
import { MiniPipo } from '../mascot/MiniPipo';
import { usePipos } from '../store/pipos';
import { useUi } from '../store/ui';
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
  const income = useData((s) => s.income);
  const money = useData((s) => s.settings?.money);
  const moneyFlash = useUi((s) => s.moneyFlash);
  const showMoney = !!income && money?.showInPill !== false;
  const amount = income ? income[money?.period ?? 'today'] : 0;
  const moneyText = income ? (money?.hideValues ? '↑' : fmtMoney(amount, income.currency, true)) : '';
  const moneyTitle = income ? t.money.tooltip(fmtMoney(income.today, income.currency), fmtMoney(income.week, income.currency), fmtMoney(income.month, income.currency), income.paymentsToday) : undefined;
  const team = usePipos((s) => s.list);
  const arrivingId = usePipos((s) => s.arrivingId);
  const flashIds = usePipos((s) => s.flashIds);
  // Quem está trabalhando ou esperando aparece primeiro; até 4 na pill, o resto vira "+N".
  const order = { waiting: 0, working: 1, error: 2, done: 3, draft: 4, idle: 5 } as const;
  const minis = [...team].sort((a, b) => order[a.live.state] - order[b.live.state]);
  const shown = minis.slice(0, 4);
  const statusDot = badge === 'attention' ? '#F59E0B' : badge === 'done' ? '#22C55E' : focus?.phase === 'focus' ? '#3B82F6' : null;

  return (
    <div className="flex h-full w-full items-center justify-between px-[12px]">
      <div className="relative flex h-full min-w-[64px] items-center gap-[2px]">
        <div className="relative -my-2">
          <Mascot state={state} mood={mood} size={22} accessories={accessories.filter((a) => a !== 'coffee')} glow={false} still={state === 'idle' || state === 'sleepy' || state === 'tired'} />
          {statusDot && <span className="absolute left-[2px] top-[5px] h-[6px] w-[6px] rounded-full" style={{ background: statusDot, boxShadow: '0 0 0 1.5px #000' }} />}
        </div>
        {shown.length > 0 && (
          <div className="ml-[2px] flex items-center">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex"
                onClick={(e) => {
                  e.stopPropagation();
                  usePipos.getState().open(p.id, p.live.runId);
                  useUi.getState().setTab('team');
                }}
              >
                <MiniPipo
                  color={PIPO_COLORS[p.color]}
                  state={p.live.state === 'idle' && !p.activeVersion ? 'draft' : p.live.state}
                  size={14}
                  title={`${p.name}${p.live.stepLabel ? ` · ${p.live.stepLabel}` : p.live.state === 'idle' ? '' : ` · ${p.live.state}`}`}
                  arriving={arrivingId === p.id}
                  flash={flashIds.includes(p.id)}
                />
              </button>
            ))}
            {minis.length > 4 && <span className="mono ml-[1px] text-[9.5px] text-white/50">+{minis.length - 4}</span>}
          </div>
        )}
        {!focus && (
          // ▶ discreto: um clique começa o foco na próxima tarefa sem abrir nada antes.
          <button
            type="button"
            aria-label={t.focusNext.pill}
            title={t.focusNext.pill}
            onClick={(e) => {
              e.stopPropagation();
              void focusNext();
            }}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/15 hover:text-white"
          >
            <IconPlay size={8} />
          </button>
        )}
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
          ) : showMoney ? (
            <motion.span
              key={`money-${moneyFlash}`}
              title={moneyTitle}
              initial={moneyFlash && Date.now() - moneyFlash < 3000 ? { scale: 1.25, opacity: 0 } : { opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 14 }}
              className="mono flex items-baseline gap-[5px] text-[12.5px] font-medium"
              style={{ color: amount > 0 ? '#4ADE80' : '#A1A1AA' }}
            >
              {moneyText}
              {!money?.hideValues && <span className="text-[10px] font-normal text-white/40">{t.money.period[money?.period ?? 'today']}</span>}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex min-w-[64px] items-center justify-end gap-[8px]">
        {showMoney && (focus || clipboardCandidate) && (
          <span className="mono text-[11px]" title={moneyTitle} style={{ color: amount > 0 ? '#4ADE80' : '#A1A1AA' }}>
            {moneyText}
          </span>
        )}
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
