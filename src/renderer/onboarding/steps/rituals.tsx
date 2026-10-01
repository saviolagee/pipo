import { useState } from 'react';
import type { CustomRitualConfig, MusicConfig, Ritual, RitualKind } from '@shared/types';
import { Button } from '../../components/Button';
import { Chip, Label, Option, TextField, YesNo } from '../../components/Form';
import { t } from '../../i18n/pt-BR';
import { api } from '../../lib/api';
import { useData } from '../../store/data';
import type { Draft, StepProps } from '../draft';

const o = t.onboarding;
const KINDS: Exclude<RitualKind, 'custom'>[] = ['music', 'coffee', 'phone', 'desk', 'top3', 'two_min', 'tabs', 'breathe'];

export const DEFAULT_MUSIC: MusicConfig = { source: null, link: null, filePath: null, autoplay: true, pauseOnBreak: true };

function labelFor(kind: RitualKind): string {
  return o.rituals[kind].replace(/^\S+\s/, '');
}

export function hasRitual(d: Draft, kind: RitualKind): boolean {
  return d.rituals.some((r) => r.kind === kind && r.enabled);
}

export function RitualsStep({ draft, set }: StepProps): React.JSX.Element {
  const [own, setOwn] = useState('');
  const toggle = (kind: Exclude<RitualKind, 'custom'>): void =>
    set((d) => {
      if (d.rituals.some((r) => r.kind === kind)) return { ...d, rituals: d.rituals.filter((r) => r.kind !== kind) };
      const config = kind === 'music' ? { ...DEFAULT_MUSIC } : {};
      return { ...d, rituals: [...d.rituals, { kind, label: labelFor(kind), enabled: true, config, position: d.rituals.length }] };
    });
  const addOwn = (): void => {
    const label = own.trim();
    if (!label) return;
    set((d) => ({ ...d, rituals: [...d.rituals, { kind: 'custom', label, enabled: true, config: { remind: true }, position: d.rituals.length }] }));
    setOwn('');
  };
  const customs = draft.rituals.filter((r) => r.kind === 'custom');
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap gap-[6px]">
        {KINDS.map((k) => (
          <Chip key={k} on={draft.rituals.some((r) => r.kind === k)} onClick={() => toggle(k)}>
            {o.rituals[k]}
          </Chip>
        ))}
        {customs.map((r) => (
          <Chip key={r.label} on onClick={() => set((d) => ({ ...d, rituals: d.rituals.filter((x) => x !== r) }))}>
            ➕ {r.label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-[8px]">
        <TextField value={own} onChange={setOwn} placeholder={o.ownPlaceholder} onEnter={addOwn} className="w-[220px]" ariaLabel={o.addOwn} pinKey="own" />
        <Button size="sm" onClick={addOwn} disabled={!own.trim()}>
          {o.addOwn}
        </Button>
      </div>
      <p className="text-[12px] text-fg-3">{o.ritualsHint}</p>
    </div>
  );
}

function patchMusic(d: Draft, patch: Partial<MusicConfig>): Draft {
  return {
    ...d,
    rituals: d.rituals.map((r) => (r.kind === 'music' ? { ...r, config: { ...DEFAULT_MUSIC, ...(r.config as MusicConfig), ...patch } } : r)),
  };
}

export function MusicStep({ draft, set }: StepProps): React.JSX.Element {
  const r = draft.rituals.find((x) => x.kind === 'music');
  const cfg: MusicConfig = { ...DEFAULT_MUSIC, ...((r?.config as MusicConfig) ?? {}) };
  const spotify = useData((s) => s.integrations.find((i) => i.provider === 'spotify'));
  const [err, setErr] = useState<string | null>(null);

  const connectSpotify = async (): Promise<void> => {
    setErr(null);
    try {
      const info = await api.invoke('integrations:connect', 'spotify');
      useData.getState().set({ integrations: await api.invoke('integrations:list') });
      if (info.status === 'connected') set((d) => patchMusic(d, { source: 'spotify' }));
      else setErr(info.detail);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };

  const pickFile = async (): Promise<void> => {
    const p = await api.invoke('app:pickFile', 'audio');
    if (p) set((d) => patchMusic(d, { source: 'file', filePath: p }));
  };

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-3 gap-[8px]">
        <Option on={cfg.source === 'spotify'} onClick={() => void connectSpotify()} title={spotify?.status === 'connected' ? `${o.musicSpotify} ✓` : o.musicSpotify} />
        <Option on={cfg.source === 'link'} onClick={() => set((d) => patchMusic(d, { source: 'link' }))} title={o.musicLink} />
        <Option on={cfg.source === 'file'} onClick={() => void pickFile()} title={cfg.filePath ? cfg.filePath.split(/[\\/]/).pop() ?? o.musicFile : o.musicFile} />
      </div>
      {err && <p className="text-[12px] text-attention">{err}</p>}
      {(cfg.source === 'link' || cfg.source === 'spotify') && (
        <TextField value={cfg.link ?? ''} onChange={(link) => set((d) => patchMusic(d, { link }))} placeholder={o.musicLinkPlaceholder} className="w-full" pinKey="music" />
      )}
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[8px]">
        <span className="flex items-center gap-[8px] text-[12px] text-fg-2">
          {o.musicAutoplay} <YesNo value={cfg.autoplay} onChange={(autoplay) => set((d) => patchMusic(d, { autoplay }))} />
        </span>
        <span className="flex items-center gap-[8px] text-[12px] text-fg-2">
          {o.musicPause} <YesNo value={cfg.pauseOnBreak} onChange={(pauseOnBreak) => set((d) => patchMusic(d, { pauseOnBreak }))} />
        </span>
      </div>
    </div>
  );
}

export function CustomRitualStep({ draft, set }: StepProps): React.JSX.Element {
  const customs = draft.rituals.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'custom');
  const patch = (i: number, p: Partial<Omit<Ritual, 'id'>>): void => set((d) => ({ ...d, rituals: d.rituals.map((r, j) => (j === i ? { ...r, ...p } : r)) }));
  return (
    <div className="flex flex-col gap-[10px]">
      {customs.map(({ r, i }) => (
        <div key={i} className="flex flex-wrap items-center gap-[10px]">
          <div>
            <Label>{o.customName}</Label>
            <TextField value={r.label} onChange={(label) => patch(i, { label })} className="w-[200px]" pinKey={`custom${i}`} />
          </div>
          <div>
            <Label>{o.customRemind}</Label>
            <YesNo value={(r.config as CustomRitualConfig).remind ?? true} onChange={(remind) => patch(i, { config: { remind } })} />
          </div>
        </div>
      ))}
    </div>
  );
}
