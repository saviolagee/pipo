import { motion } from 'motion/react';
import { t } from '../i18n/pt-BR';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { IconPause, IconPlay } from './Icons';
import { INTEGRATION_COLORS, MiniFace } from './MiniFace';
import { api } from '../lib/api';

type ChipId = keyof typeof INTEGRATION_COLORS;

export function useIntegrationFlags(): Record<ChipId, boolean> {
  const integrations = useData((s) => s.integrations);
  const claude = useData((s) => s.claude);
  const google = integrations.find((i) => i.provider === 'google')?.status === 'connected';
  const spotifyConnected = integrations.find((i) => i.provider === 'spotify')?.status === 'connected';
  const musicLink = useData((s) => s.rituals.some((r) => r.kind === 'music' && r.enabled));
  return {
    google_calendar: google,
    gmail: google,
    spotify: spotifyConnected || musicLink,
    claude: claude.state === 'ok',
  };
}

/** Chips de integração 2×2 [Ref 3, 5]. */
export function IntegrationGrid(): React.JSX.Element {
  const flags = useIntegrationFlags();
  const nowPlaying = useData((s) => s.nowPlaying);
  const setTab = useUi((s) => s.setTab);
  const ids: ChipId[] = ['google_calendar', 'gmail', 'spotify', 'claude'];

  return (
    <div className="grid h-full grid-cols-2 gap-[6px]">
      {ids.map((id) => {
        const on = flags[id];
        const playing = id === 'spotify' && nowPlaying;
        return (
          <button
            key={id}
            type="button"
            aria-label={`${t.integrations[id]}: ${on ? t.integrations.connected : t.integrations.disconnected}`}
            onClick={() => (on && playing ? void api.invoke('music:toggle') : setTab('settings'))}
            className="flex min-w-0 items-center gap-[9px] rounded-[10px] px-[10px] text-[12px] font-medium transition-colors hover:bg-white/[0.07]"
            style={{ background: 'var(--bg-card-hover)', opacity: on ? 1 : 0.4, height: 34 }}
          >
            <MiniFace color={INTEGRATION_COLORS[id]} size={20} />
            {playing ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left text-fg-2">
                  <motion.span className="inline-block" animate={{ x: ['0%', '-50%'] }} transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}>
                    {playing.track} · {playing.artist}&nbsp;&nbsp;&nbsp;&nbsp;{playing.track} · {playing.artist}&nbsp;&nbsp;&nbsp;&nbsp;
                  </motion.span>
                </span>
                {playing.playing ? <IconPause size={10} /> : <IconPlay size={10} />}
              </span>
            ) : (
              <span className="flex-1 truncate text-center text-fg-2">{t.integrations[id]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
