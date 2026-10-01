import { useEffect, useState } from 'react';
import type { CustomRitualConfig, MusicConfig } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useData } from '../store/data';

const f = t.focus;

function musicName(cfg: MusicConfig): string {
  if (cfg.source === 'file' && cfg.filePath) return cfg.filePath.split(/[\\/]/).pop() ?? f.musicFile;
  return f.musicLink;
}

/** Ritual de início: checklist rápido antes do foco (seção 9.3). Enter = Pronto. */
export function RitualCheck(): React.JSX.Element {
  const all = useData((s) => s.rituals);
  const rituals = all.filter((r) => r.enabled);
  const focus = useData((s) => s.focus);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const items = rituals.filter((r) => r.kind !== 'music' && (r.kind !== 'custom' || (r.config as CustomRitualConfig).remind !== false));
  const music = rituals.find((r) => r.kind === 'music');

  const ready = (skip = false): void => void api.invoke('focus:ritualDone', skip);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ready();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="px-[10px] pb-[10px]">
      <div className="flex items-center gap-[16px] rounded-[16px] px-[16px] py-[14px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex w-[84px] shrink-0 justify-center">
          <Mascot state="idle" size={66} accessories={focus?.musicActive ? ['headphones'] : []} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px] text-[12px]">
            <span className="h-[6px] w-[6px] rounded-full bg-white" />
            <span className="font-semibold">{f.ritualTitle}</span>
            <span className="truncate text-fg-2">{focus?.taskTitle}</span>
          </div>
          <div className="mt-[8px] flex flex-wrap gap-x-[14px] gap-y-[6px]">
            {items.map((r) => (
              <label key={r.id} className="flex cursor-default items-center gap-[7px] text-[13px]">
                <input type="checkbox" className="h-[14px] w-[14px] accent-white" checked={!!checked[r.id]} onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />
                <span className={checked[r.id] ? 'text-fg-3 line-through' : ''}>{t.onboarding.rituals[r.kind] && r.kind !== 'custom' ? t.onboarding.rituals[r.kind] : `➕ ${r.label}`}</span>
              </label>
            ))}
          </div>
          {music && focus?.musicActive && <p className="mt-[8px] text-[12px] text-fg-2">🎧 {f.playing(musicName(music.config as MusicConfig))}</p>}
          <div className="mt-[10px] flex items-center gap-[8px]">
            <Button size="sm" variant="primary" kbd="↵" onClick={() => ready()}>
              {f.ritualReady}
            </Button>
            <Button size="sm" variant="tertiary" onClick={() => ready(true)}>
              {f.ritualSkip}
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => void api.invoke('focus:stop', false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
