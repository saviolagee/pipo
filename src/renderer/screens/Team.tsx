// Aba Equipe: os Pipos coloridos do usuário. Nenhum vem instalado; o convite leva ao /criarpipo.
import { motion } from 'motion/react';
import { PIPO_COLORS, type PipoSummary } from '@shared/pipos';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { Mascot } from '../mascot/Mascot';
import { useChat } from '../store/chat';
import { usePipos } from '../store/pipos';
import { useUi } from '../store/ui';

const tt = t.team;

export function startCreatePipo(): void {
  useUi.getState().setTab('chat');
  useChat.getState().newConversation();
  void useChat.getState().send('/criarpipo');
}

function EmptyTeam(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[10px] text-center">
      <div className="flex items-end gap-[6px] opacity-90">
        <Mascot state="idle" size={34} color={PIPO_COLORS.orange} glow={false} still />
        <Mascot state="happy" size={46} glow={false} />
        <Mascot state="idle" size={34} color={PIPO_COLORS.blue} glow={false} still />
      </div>
      <p className="text-[14px] font-semibold text-fg">{tt.emptyTitle}</p>
      <p className="max-w-[380px] text-[12.5px] text-fg-2">{tt.emptyBody}</p>
      <Button variant="primary" onClick={startCreatePipo}>
        {tt.create}
      </Button>
    </div>
  );
}

export function PipoCard({ p, onOpen }: { p: PipoSummary; onOpen: () => void }): React.JSX.Element {
  const color = PIPO_COLORS[p.color];
  const working = p.live.state === 'working' || p.live.state === 'waiting';
  return (
    <motion.button
      type="button"
      layout
      onClick={onOpen}
      className="flex min-w-0 items-center gap-[10px] rounded-[14px] p-[10px] text-left transition-colors hover:bg-white/[0.06]"
      style={{ background: 'var(--bg-card)', border: `1px solid ${working ? `${color}66` : 'var(--border-subtle)'}` }}
    >
      <Mascot state={working ? 'working' : p.paused ? 'sleepy' : 'idle'} size={36} color={color} glow={working} still={!working} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[6px] text-[13px] font-semibold text-fg">
          <span className="truncate">{p.name}</span>
          {p.paused && <span className="text-[10.5px] font-normal text-fg-3">{tt.paused}</span>}
        </span>
        <span className="block truncate text-[11.5px] text-fg-2">{p.live.stepLabel ?? p.personality.mission}</span>
      </span>
    </motion.button>
  );
}

export function TeamScreen(): React.JSX.Element {
  const list = usePipos((s) => s.list);
  const loaded = usePipos((s) => s.loaded);
  return (
    <div className="flex h-[372px] flex-col px-[12px] pb-[12px]">
      {loaded && list.length === 0 ? (
        <EmptyTeam />
      ) : (
        <>
          <div className="flex items-center justify-between px-[4px] pb-[8px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{tt.title(list.length)}</span>
            <Button size="sm" onClick={startCreatePipo}>
              + {tt.create}
            </Button>
          </div>
          <div className="scroll-thin grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-[8px] overflow-y-auto">
            {list.map((p) => (
              <PipoCard key={p.id} p={p} onOpen={() => usePipos.getState().open(p.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
