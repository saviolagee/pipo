import type { Accessory, MascotState } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { Mascot, type Badge } from '../mascot/Mascot';
import { useData } from '../store/data';

interface Props {
  state: MascotState;
  badge: Badge;
  mood: number;
  accessories: Accessory[];
}

/** O Pipo recolhido no modo miniatura: só o rosto, com o mesmo ponto de estado da pill. Um clique abre o notch. */
export function MiniBubble({ state, badge, mood, accessories }: Props): React.JSX.Element {
  const focus = useData((s) => s.focus);
  const dot = badge === 'attention' ? '#F59E0B' : badge === 'done' ? '#22C55E' : focus?.phase === 'focus' ? '#3B82F6' : null;
  return (
    <div className="relative flex h-full w-full cursor-pointer items-center justify-center" title={t.mini.open}>
      <Mascot state={state} mood={mood} size={30} accessories={accessories.filter((a) => a !== 'coffee')} glow={false} still={state === 'idle' || state === 'sleepy' || state === 'tired'} />
      {dot && <span className="absolute right-[8px] top-[8px] h-[7px] w-[7px] rounded-full" style={{ background: dot, boxShadow: '0 0 0 1.5px #000' }} />}
    </div>
  );
}
