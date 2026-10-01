import type { SfxName } from '@shared/ipc-contract';
import type { Accessory, GlowKind, MascotState } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { play } from '../sound/sfx';
import { useUi } from '../store/ui';

const STATES: MascotState[] = ['idle', 'looking', 'happy', 'working', 'thinking', 'attention', 'sleepy', 'eating', 'celebrating', 'dizzy', 'sad', 'tired', 'listening', 'shh'];
const ACCESSORIES: Accessory[] = ['headphones', 'glasses', 'coffee', 'nightcap', 'scarf', 'cool_glasses', 'hat', 'crown', 'cape'];
const GLOWS: GlowKind[] = ['none', 'focus', 'attention', 'done', 'dizzy'];
const SFX: SfxName[] = ['pop', 'chime', 'alert', 'gulp', 'boing', 'tick'];
const SIMS = ['meeting', 'pomodoro_end', 'distraction', 'deadline', 'goal', 'pattern', 'unlock', 'seed4weeks'] as const;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-[9px] py-[3px] text-[11px] ${on ? 'bg-white text-black' : 'bg-white/[0.07] text-fg-2 hover:text-fg'}`}>
      {children}
    </button>
  );
}

/** Tela de debug (Ctrl+Alt+D): alterna estados, humor, acessórios, glow, sons e simulações. */
export function DebugPanel(): React.JSX.Element {
  const debug = useUi((s) => s.debug);
  const glow = useUi((s) => s.glowOverride);
  const set = useUi((s) => s.set);
  const acc = debug.accessories ?? [];

  return (
    <div
      className="pointer-events-auto absolute bottom-[8px] left-1/2 w-[680px] -translate-x-1/2 rounded-[16px] p-[12px] text-[12px]"
      style={{ background: 'rgba(10,10,12,0.96)', border: '1px solid rgba(255,255,255,0.1)' }}
      onMouseEnter={() => void api.invoke('window:setInteractive', true)}
      onMouseLeave={() => void api.invoke('window:setInteractive', false)}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">{t.debug.title}</span>
        <button type="button" className="text-fg-2 hover:text-fg" onClick={() => set({ debugOpen: false, debug: { state: null, mood: null, accessories: null }, glowOverride: null })}>
          {t.common.close}
        </button>
      </div>
      <Row label={t.debug.state}>
        <Chip on={debug.state === null} onClick={() => set({ debug: { ...debug, state: null } })}>
          auto
        </Chip>
        {STATES.map((s) => (
          <Chip key={s} on={debug.state === s} onClick={() => set({ debug: { ...debug, state: s }, expanded: true })}>
            {s}
          </Chip>
        ))}
      </Row>
      <div className="mt-[8px] grid grid-cols-7 gap-y-[2px] rounded-[12px] py-[6px]" style={{ background: '#08080A' }}>
        {STATES.map((s) => (
          <button key={s} type="button" onClick={() => set({ debug: { ...debug, state: s } })} className="flex flex-col items-center text-[10px] text-fg-3">
            <Mascot state={s} size={34} mood={debug.mood ?? 60} accessories={acc} badge={s === 'attention' ? 'attention' : s === 'happy' ? 'done' : s === 'working' ? 'working' : null} glow={false} />
            {s}
          </button>
        ))}
      </div>
      <Row label={`${t.debug.mood} ${debug.mood ?? 'auto'}`}>
        <input type="range" min={0} max={100} value={debug.mood ?? 60} onChange={(e) => set({ debug: { ...debug, mood: Number(e.target.value) } })} className="w-[260px]" />
        <Chip on={debug.mood === null} onClick={() => set({ debug: { ...debug, mood: null } })}>
          auto
        </Chip>
      </Row>
      <Row label={t.debug.accessories}>
        {ACCESSORIES.map((a) => (
          <Chip key={a} on={acc.includes(a)} onClick={() => set({ debug: { ...debug, accessories: acc.includes(a) ? acc.filter((x) => x !== a) : [...acc, a] } })}>
            {a}
          </Chip>
        ))}
      </Row>
      <Row label={t.debug.glow}>
        {GLOWS.map((g) => (
          <Chip key={g} on={glow === g} onClick={() => set({ glowOverride: glow === g ? null : g })}>
            {g}
          </Chip>
        ))}
      </Row>
      <Row label="Ações">
        <Chip on={false} onClick={() => set({ entranceKey: useUi.getState().entranceKey + 1, expanded: true, tab: 'home' })}>
          {t.debug.entrance}
        </Chip>
        <Chip on={false} onClick={() => useUi.getState().confetti(24)}>
          {t.debug.confetti}
        </Chip>
        {SFX.map((s) => (
          <Chip key={s} on={false} onClick={() => play(s)}>
            ♪ {s}
          </Chip>
        ))}
      </Row>
      <Row label={t.debug.simulate}>
        {SIMS.map((s) => (
          <Chip key={s} on={false} onClick={() => void api.invoke('debug:simulate', s)}>
            {s}
          </Chip>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-[6px] flex items-start gap-2">
      <span className="w-[86px] shrink-0 pt-[3px] text-fg-3">{label}</span>
      <div className="flex flex-wrap items-center gap-[4px]">{children}</div>
    </div>
  );
}
