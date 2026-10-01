import { useEffect, useState } from 'react';
import type { Settings as SettingsT, UnlockableAccessory } from '@shared/types';
import { Button } from '../components/Button';
import { DaysSettings } from './DaysSettings';
import { ACTIVITY } from '@shared/config';
import { Chip, Label, Option, Slider, TagInput, TextField, YesNo } from '../components/Form';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import type { Draft, StepProps } from '../onboarding/draft';
import { initialDraft, persistDraft } from '../onboarding/Onboarding';
import { EnergyStep, FocusStep, GoalStep, NameStep, RoutineStep } from '../onboarding/steps/basics';
import { ClaudeStep, GoogleStep, PermissionsStep } from '../onboarding/steps/connections';
import { ClientsStep, DistractionsStep } from '../onboarding/steps/context';
import { AutostartStep, PersonalityStep } from '../onboarding/steps/personality';
import { CustomRitualStep, hasRitual, MusicStep, RitualsStep } from '../onboarding/steps/rituals';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

const s = t.settings;
type SectionId = keyof typeof s.sections;
const SECTIONS: SectionId[] = ['profile', 'goal', 'days', 'focus', 'rituals', 'distractions', 'clients', 'integrations', 'agent', 'personality', 'privacy', 'shortcuts', 'data'];
const DRAFT_SECTIONS: SectionId[] = ['profile', 'goal', 'focus', 'rituals', 'distractions', 'clients', 'personality'];

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}

function Block({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-[16px]">
      {title && <Label>{title}</Label>}
      {children}
    </div>
  );
}

export function SettingsScreen(): React.JSX.Element {
  const [section, setSection] = useState<SectionId>('profile');
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const settings = useData((st) => st.settings);
  const set: StepProps['set'] = (fn) => {
    setDraft((d) => fn(d));
    setDirty(true);
  };

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(id);
  }, [msg]);

  const save = async (): Promise<void> => {
    try {
      await persistDraft(draft, false);
      setDraft(initialDraft());
      setDirty(false);
      setMsg(s.saved);
      void useData.getState().refreshStats();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const patchSettings = async (patch: Partial<SettingsT>): Promise<void> => {
    try {
      useData.getState().set({ settings: await api.invoke('settings:patch', patch) });
      setMsg(s.saved);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const content = ((): React.ReactNode => {
    const p = { draft, set };
    switch (section) {
      case 'profile':
        return (
          <>
            <Block title={t.onboarding.namePlaceholder}>
              <NameStep {...p} />
            </Block>
            <RoutineStep {...p} />
            <Block title={t.onboarding.autostartSay}>
              <AutostartStep {...p} />
            </Block>
          </>
        );
      case 'goal':
        return <GoalStep {...p} />;
      case 'days':
        return <DaysSettings onMsg={setMsg} />;
      case 'focus':
        return (
          <>
            <Block title={t.onboarding.energySay}>
              <EnergyStep {...p} />
            </Block>
            <Block title={t.onboarding.focusSay}>
              <FocusStep {...p} />
            </Block>
          </>
        );
      case 'rituals':
        return (
          <>
            <RitualsStep {...p} />
            {hasRitual(draft, 'music') && (
              <Block title={t.onboarding.musicSay}>
                <MusicStep {...p} />
              </Block>
            )}
            {hasRitual(draft, 'custom') && <CustomRitualStep {...p} />}
          </>
        );
      case 'distractions':
        return <DistractionsStep {...p} />;
      case 'clients':
        return <ClientsStep {...p} />;
      case 'integrations':
        return (
          <>
            <Block title="Google Agenda + Gmail">
              <GoogleStep />
            </Block>
            <Block title="Spotify">
              <SpotifyBlock />
            </Block>
            <Block title="Claude">
              <ClaudeStep />
              <ApiKeyBlock />
            </Block>
            {useData.getState().platform === 'darwin' && (
              <Block title="macOS">
                <PermissionsStep />
              </Block>
            )}
          </>
        );
      case 'agent':
        return settings ? <AgentBlock settings={settings} onPatch={patchSettings} /> : null;
      case 'personality':
        return (
          <>
            <PersonalityStep {...p} />
            <Block title={s.accessories}>
              <AccessoriesBlock />
            </Block>
            {settings && (
              <Block title={s.volume}>
                <div className="flex max-w-[280px] items-center gap-3">
                  <Slider ariaLabel={s.volume} min={0} max={1} step={0.05} value={settings.volume} onChange={(volume) => void patchSettings({ volume })} />
                  <YesNo value={!settings.muted} onChange={(on) => void patchSettings({ muted: !on })} yes="🔊" no="🔇" />
                </div>
              </Block>
            )}
          </>
        );
      case 'privacy':
        return settings ? <PrivacyBlock settings={settings} onPatch={patchSettings} onMsg={setMsg} /> : null;
      case 'shortcuts':
        return settings ? <ShortcutsBlock settings={settings} onPatch={patchSettings} /> : null;
      case 'data':
        return <DataBlock onMsg={setMsg} />;
    }
  })();

  return (
    <div className="flex h-[372px] gap-[10px] px-[10px] pb-[10px]">
      <nav className="scroll-thin flex w-[150px] shrink-0 flex-col gap-[1px] overflow-y-auto rounded-[14px] p-[6px]" style={{ background: 'var(--bg-card)' }}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`rounded-[8px] px-[10px] py-[5px] text-left text-[12px] transition-colors ${section === id ? 'bg-white/[0.1] text-fg' : 'text-fg-2 hover:text-fg'}`}
          >
            {s.sections[id]}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          className="rounded-[8px] px-[10px] py-[6px] text-left text-[12px] text-fg-3 hover:text-fg"
          onClick={async () => {
            await api.invoke('profile:resetOnboarding');
            const profile = useData.getState().profile;
            useData.getState().set({ profile: profile ? { ...profile, onboardedAt: null } : null, firstRun: true });
            useUi.getState().setTab('home');
          }}
        >
          ↺ {s.redoOnboarding}
        </button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col rounded-[14px] p-[14px]" style={{ background: 'var(--bg-card)' }}>
        <div className="mb-[10px] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{s.sections[section]}</h2>
          <span className="text-[12px] text-fg-2">{msg}</span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-[4px]">{content}</div>
        {DRAFT_SECTIONS.includes(section) && (
          <div className="mt-[8px] flex justify-end gap-[8px]">
            {dirty && (
              <Button
                size="sm"
                onClick={() => {
                  setDraft(initialDraft());
                  setDirty(false);
                }}
              >
                {t.common.cancel}
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void save()}>
              {t.common.save}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SpotifyBlock(): React.JSX.Element {
  const info = useData((st) => st.integrations.find((i) => i.provider === 'spotify'));
  const [clientId, setClientId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const connected = info?.status === 'connected';
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setErr(null);
    try {
      await fn();
      useData.getState().set({ integrations: await api.invoke('integrations:list') });
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[8px]">
        {connected ? (
          <>
            <span className="text-[12px] text-done">✓ {info?.detail ?? t.integrations.connected}</span>
            <Button size="sm" onClick={() => void run(() => api.invoke('integrations:disconnect', 'spotify'))}>
              {t.integrations.disconnect}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void run(() => api.invoke('integrations:connect', 'spotify'))}>
            {t.integrations.connect}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-[8px]">
        <TextField value={clientId} onChange={setClientId} placeholder="Spotify Client ID (opcional)" className="w-[240px] text-[12px]" pinKey="spclient" />
        <Button size="sm" disabled={!clientId.trim()} onClick={() => void run(() => api.invoke('integrations:setSpotifyClient', { clientId: clientId.trim() }))}>
          {t.common.save}
        </Button>
      </div>
      {err && <p className="text-[12px] text-attention">{err}</p>}
    </div>
  );
}

/** Avançado: provedor por chave de API (desativado por padrão; o padrão é a assinatura via Claude Code). */
function AgentBlock({ settings, onPatch }: { settings: SettingsT; onPatch: (p: Partial<SettingsT>) => Promise<void> }): React.JSX.Element {
  const a = settings.agent;
  const models = ['sonnet', 'opus', 'haiku', 'default'] as const;
  return (
    <>
      <Block title={s.agentModel}>
        <div className="grid grid-cols-2 gap-[8px]">
          {models.map((m) => (
            <Option key={m} on={a.model === m} onClick={() => void onPatch({ agent: { ...a, model: m } })} title={s.agentModels[m][0]} desc={s.agentModels[m][1]} />
          ))}
        </div>
      </Block>
      <Block title={s.agentEffort}>
        {a.model === 'haiku' ? (
          <p className="text-[12px] text-fg-3">{s.agentEffortHaiku}</p>
        ) : (
          <div className="flex gap-[6px]">
            {(['low', 'medium', 'high'] as const).map((e) => (
              <Chip key={e} on={a.effort === e} onClick={() => void onPatch({ agent: { ...a, effort: e } })}>
                {s.agentEfforts[e]}
              </Chip>
            ))}
          </div>
        )}
        <p className="mt-[8px] text-[11px] text-fg-3">{s.agentThinkHint}</p>
      </Block>
    </>
  );
}

function ApiKeyBlock(): React.JSX.Element {
  const [info, setInfo] = useState<{ provider: 'claude-code' | 'anthropic-api'; hasKey: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api.invoke('agent:getProvider').then(setInfo);
  }, []);
  if (!info) return <></>;
  const set = async (provider: 'claude-code' | 'anthropic-api', apiKey?: string): Promise<void> => {
    await api.invoke('agent:setProvider', { provider, apiKey });
    setInfo(await api.invoke('agent:getProvider'));
    setKey('');
  };
  return (
    <div className="mt-[10px]">
      <button type="button" className="text-[11px] text-fg-3 hover:text-fg" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {s.apiAdvanced}
      </button>
      {open && (
        <div className="mt-[6px] flex flex-col gap-[8px]">
          <p className="text-[11px] text-fg-3">{s.apiHint}</p>
          <YesNo value={info.provider === 'anthropic-api'} onChange={(on) => void set(on ? 'anthropic-api' : 'claude-code')} yes={s.apiUseKey} no={s.apiUseSubscription} />
          <div className="flex items-center gap-[8px]">
            <TextField value={key} onChange={setKey} placeholder={info.hasKey ? '••••••••••••' : 'sk-ant-…'} className="w-[240px] text-[12px]" pinKey="apikey" ariaLabel="API key" />
            <Button size="sm" disabled={!key.trim()} onClick={() => void set(info.provider, key.trim())}>
              {t.common.save}
            </Button>
            {info.hasKey && (
              <Button size="sm" variant="tertiary" onClick={() => void set('claude-code', '')}>
                {t.common.remove}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AccessoriesBlock(): React.JSX.Element {
  const streak = useData((st) => st.streak);
  if (!streak.unlocked.length) return <p className="text-[12px] text-fg-3">{s.noAccessories}</p>;
  const toggle = async (a: UnlockableAccessory): Promise<void> => {
    const equipped = streak.equipped.includes(a) ? streak.equipped.filter((x) => x !== a) : [...streak.equipped, a];
    useData.getState().set({ streak: await api.invoke('streak:equip', equipped) });
  };
  return (
    <div className="flex items-center gap-[10px]">
      <Mascot state="happy" size={44} accessories={streak.equipped} glow={false} />
      <div className="flex flex-wrap gap-[6px]">
        {streak.unlocked.map((a) => (
          <Chip key={a} on={streak.equipped.includes(a)} onClick={() => void toggle(a)}>
            {{ scarf: '🧣 Cachecol', cool_glasses: '🕶️ Óculos', hat: '🎩 Chapéu', crown: '👑 Coroa', cape: '🦸 Capa' }[a]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function PrivacyBlock({ settings, onPatch, onMsg }: { settings: SettingsT; onPatch: (p: Partial<SettingsT>) => Promise<void>; onMsg: (m: string) => void }): React.JSX.Element {
  const del = async (range: 'today' | 'week' | 'all'): Promise<void> => {
    const now = new Date();
    const from = range === 'all' ? new Date(0) : range === 'week' ? new Date(now.getTime() - 7 * 86_400_000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    try {
      const n = await api.invoke('activity:deleteRange', from.toISOString(), now.toISOString());
      onMsg(s.deleted(n));
    } catch (e) {
      onMsg(errText(e));
    }
  };
  const r = settings.reactions;
  return (
    <>
      <Block>
        <div className="flex items-center gap-[10px] text-[12px] text-fg-2">
          {s.trackingPaused}
          <YesNo value={settings.privacy.trackingPaused} onChange={(trackingPaused) => void onPatch({ privacy: { ...settings.privacy, trackingPaused } })} />
        </div>
      </Block>
      <Block title={s.activeTime}>
        <p className="mb-[6px] text-[11.5px] text-fg-3">{s.activeTimeHint}</p>
        <div className="flex gap-[6px]">
          {ACTIVITY.idleOptionsSec.map((sec) => (
            <Chip key={sec} on={(settings.activity?.idleAfterSec ?? ACTIVITY.idleThresholdSec) === sec} onClick={() => void onPatch({ activity: { idleAfterSec: sec } })}>
              {sec < 60 ? `${sec}s` : `${sec / 60} min`}
            </Chip>
          ))}
        </div>
      </Block>
      <Block title={s.ignoredApps}>
        <TagInput values={settings.privacy.ignoredApps} onChange={(ignoredApps) => void onPatch({ privacy: { ...settings.privacy, ignoredApps } })} placeholder="+ app" />
      </Block>
      <Block title={s.deleteHistory}>
        <div className="flex gap-[6px]">
          {(['today', 'week', 'all'] as const).map((k) => (
            <Button key={k} size="sm" onClick={() => void del(k)}>
              {s.deleteRange[k]}
            </Button>
          ))}
        </div>
      </Block>
      <Block title={s.reactions}>
        <div className="grid grid-cols-2 gap-[8px] text-[12px] text-fg-2">
          {(
            [
              ['meeting', s.reactionMeeting],
              ['email', s.reactionEmail],
              ['clipboard', s.reactionClipboard],
              ['unstuck', s.reactionUnstuck],
              ['music', s.reactionMusic],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="flex items-center justify-between gap-2">
              {label}
              <YesNo value={r[k]} onChange={(v) => void onPatch({ reactions: { ...r, [k]: v } })} />
            </span>
          ))}
        </div>
      </Block>
    </>
  );
}

function ShortcutsBlock({ settings, onPatch }: { settings: SettingsT; onPatch: (p: Partial<SettingsT>) => Promise<void> }): React.JSX.Element {
  const [map, setMap] = useState(settings.shortcuts);
  const ids = Object.keys(map) as Array<keyof SettingsT['shortcuts']>;
  return (
    <>
      <p className="mb-[8px] text-[11px] text-fg-3">{s.shortcutHint}</p>
      {ids.map((id) => (
        <div key={id} className="mb-[6px] flex items-center justify-between gap-2">
          <span className="text-[12px] text-fg-2">{s.shortcutsList[id]}</span>
          <TextField value={map[id]} onChange={(v) => setMap({ ...map, [id]: v })} className="mono w-[260px] text-[12px]" pinKey={`sc-${id}`} ariaLabel={s.shortcutsList[id]} />
        </div>
      ))}
      <div className="mb-[12px] flex justify-end">
        <Button size="sm" variant="primary" onClick={() => void onPatch({ shortcuts: map })}>
          {t.common.save}
        </Button>
      </div>
      {s.shortcutsFixed.map(([k, label]) => (
        <div key={k} className="flex justify-between py-[3px] text-[12px]">
          <span className="text-fg-2">{label}</span>
          <span className="mono text-fg">{k}</span>
        </div>
      ))}
    </>
  );
}

function DataBlock({ onMsg }: { onMsg: (m: string) => void }): React.JSX.Element {
  const [confirm, setConfirm] = useState(false);
  const exportCsv = async (): Promise<void> => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    try {
      const p = await api.invoke('activity:exportCsv', from.toISOString(), to.toISOString());
      if (p) onMsg(p);
    } catch (e) {
      onMsg(errText(e));
    }
  };
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex gap-[8px]">
        <Button
          size="sm"
          onClick={async () => {
            const p = await api.invoke('app:exportData');
            if (p) onMsg(p);
          }}
        >
          {s.exportJson}
        </Button>
        <Button size="sm" onClick={() => void exportCsv()}>
          {s.exportCsv}
        </Button>
      </div>
      {confirm ? (
        <div className="flex items-center gap-[8px]">
          <span className="text-[12px] text-attention">{s.wipeConfirm}</span>
          <Button size="sm" onClick={() => setConfirm(false)}>
            {t.common.cancel}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void api.invoke('app:wipeData')}>
            {s.wipe}
          </Button>
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={() => setConfirm(true)}>
            {s.wipe}
          </Button>
        </div>
      )}
    </div>
  );
}
