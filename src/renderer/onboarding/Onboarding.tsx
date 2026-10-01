import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { MascotState } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { play } from '../sound/sfx';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { defaultDraft, type Draft, type StepProps } from './draft';
import { EnergyStep, FocusStep, GoalStep, NameStep, RoutineStep } from './steps/basics';
import { ClaudeStep, GoogleStep, PermissionsStep } from './steps/connections';
import { ClientsStep, DistractionsStep } from './steps/context';
import { AutostartStep, PersonalityStep } from './steps/personality';
import { CustomRitualStep, hasRitual, MusicStep, RitualsStep } from './steps/rituals';

const o = t.onboarding;

interface StepDef {
  id: string;
  say: (d: Draft) => string;
  mascot?: MascotState;
  skippable?: boolean;
  canNext?: (d: Draft) => boolean;
  when?: (d: Draft, platform: string) => boolean;
  render: (p: StepProps & { next: () => void }) => React.ReactNode;
}

const STEPS: StepDef[] = [
  { id: 'welcome', say: () => o.welcomeSay, mascot: 'happy', render: () => null },
  { id: 'name', say: () => o.nameSay, canNext: (d) => d.profile.name.trim().length > 0, render: (p) => <NameStep {...p} onEnter={p.next} /> },
  { id: 'routine', say: () => o.routineSay, canNext: (d) => d.profile.workDays.length > 0 && d.profile.endTime > d.profile.startTime, render: (p) => <RoutineStep {...p} /> },
  { id: 'goal', say: () => o.goalSay, render: (p) => <GoalStep {...p} /> },
  { id: 'energy', say: () => o.energySay, render: (p) => <EnergyStep {...p} /> },
  { id: 'focus', say: () => o.focusSay, render: (p) => <FocusStep {...p} /> },
  { id: 'rituals', say: () => o.ritualsSay, skippable: true, render: (p) => <RitualsStep {...p} /> },
  { id: 'music', say: () => o.musicSay, mascot: 'listening', skippable: true, when: (d) => hasRitual(d, 'music'), render: (p) => <MusicStep {...p} /> },
  { id: 'custom', say: () => o.customSay, skippable: true, when: (d) => hasRitual(d, 'custom'), render: (p) => <CustomRitualStep {...p} /> },
  { id: 'distractions', say: () => o.distractionsSay, render: (p) => <DistractionsStep {...p} /> },
  { id: 'clients', say: () => o.clientsSay, skippable: true, render: (p) => <ClientsStep {...p} /> },
  { id: 'google', say: () => o.googleSay, skippable: true, render: () => <GoogleStep /> },
  { id: 'claude', say: () => o.claudeSay, mascot: 'thinking', skippable: true, render: () => <ClaudeStep /> },
  { id: 'permissions', say: () => o.permsSay, when: (_d, platform) => platform === 'darwin', render: () => <PermissionsStep /> },
  { id: 'personality', say: () => o.personalitySay, render: (p) => <PersonalityStep {...p} /> },
  { id: 'autostart', say: () => o.autostartSay, render: (p) => <AutostartStep {...p} /> },
  { id: 'finish', say: (d) => o.finishSay(d.profile.name.trim()), mascot: 'celebrating', render: () => null },
];

export function initialDraft(): Draft {
  const s = useData.getState();
  const base = defaultDraft();
  return {
    profile: s.profile ? { ...s.profile } : base.profile,
    rituals: s.rituals.length ? s.rituals.map(({ id: _id, ...r }) => r) : base.rituals,
    clients: s.clients.length ? s.clients.map((c) => ({ ...c })) : base.clients,
    distractions: s.settings?.distractions ?? base.distractions,
  };
}

/** Salva o rascunho no banco e atualiza o store. */
export async function persistDraft(d: Draft, finishOnboarding: boolean): Promise<void> {
  const profile = await api.invoke('profile:save', { ...d.profile, onboardedAt: finishOnboarding ? new Date().toISOString() : d.profile.onboardedAt });
  const rituals = await api.invoke('rituals:save', d.rituals);
  const clients = await api.invoke('clients:save', d.clients);
  const settings = await api.invoke('settings:patch', { distractions: d.distractions });
  useData.getState().set({ profile, rituals, clients, settings });
}

export function OnboardingProgress({ index, total }: { index: number; total: number }): React.JSX.Element {
  return (
    <div className="flex h-[36px] items-center gap-[12px] px-[18px]">
      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full bg-white" initial={false} animate={{ width: `${((index + 1) / total) * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
      </div>
      <span className="mono text-[11px] text-fg-3">{o.progress(index + 1, total)}</span>
    </div>
  );
}

/** Onboarding conversacional dentro do notch (seção 7): o Pipo fala à esquerda, as opções ficam à direita. */
export function Onboarding({ onDone }: { onDone: (planNow: boolean) => void }): React.JSX.Element {
  const platform = useData((s) => s.platform);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);

  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(draft, platform)), [draft, platform]);
  const step = steps[Math.min(i, steps.length - 1)];
  const isLast = step.id === 'finish';
  const canNext = step.canNext ? step.canNext(draft) : true;

  const next = async (): Promise<void> => {
    if (!canNext || saving) return;
    const nextStep = steps[i + 1];
    if (nextStep?.id === 'finish') {
      setSaving(true);
      try {
        await persistDraft(draft, true);
        useUi.getState().confetti(28);
        play('chime');
      } finally {
        setSaving(false);
      }
    }
    setI((v) => Math.min(v + 1, steps.length - 1));
  };
  const back = (): void => setI((v) => Math.max(0, v - 1));

  const set: StepProps['set'] = (fn) => setDraft((d) => fn(d));

  return (
    <div>
      <OnboardingProgress index={i} total={steps.length} />
    <div
      className="flex h-[262px] flex-col px-[18px] pb-[14px]"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement) && !isLast) void next();
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.18 }}
          className={`flex min-h-0 flex-1 gap-[18px] ${step.id === 'welcome' || isLast ? 'items-center' : ''}`}
        >
          <div className={`flex shrink-0 flex-col ${step.id === 'welcome' || isLast ? 'w-full items-center text-center' : 'w-[200px]'}`}>
            <Mascot state={step.mascot ?? 'idle'} size={step.id === 'welcome' || isLast ? 70 : 52} />
            <p className={`mt-[10px] font-medium leading-snug text-fg ${step.id === 'welcome' || isLast ? 'max-w-[420px] text-[15px]' : 'text-[14px]'}`}>{step.say(draft)}</p>
          </div>
          {step.id !== 'welcome' && !isLast && <div className="scroll-thin min-w-0 flex-1 overflow-y-auto pt-[4px]">{step.render({ draft, set, next: () => void next() })}</div>}
        </motion.div>
      </AnimatePresence>

      <div className="mt-[10px] flex items-center justify-between">
        <div>
          {i > 0 && !isLast && (
            <Button variant="ghost" size="sm" onClick={back}>
              {t.common.back}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-[8px]">
          {step.skippable && (
            <Button variant="tertiary" size="sm" onClick={() => void next()}>
              {t.common.skip}
            </Button>
          )}
          {step.id === 'welcome' && (
            <Button variant="primary" onClick={() => void next()} kbd="↵">
              {o.welcomeCta}
            </Button>
          )}
          {step.id !== 'welcome' && !isLast && (
            <Button variant="primary" onClick={() => void next()} disabled={!canNext || saving}>
              {t.common.next}
            </Button>
          )}
          {isLast && (
            <>
              <Button onClick={() => onDone(false)}>{o.later}</Button>
              <Button variant="primary" onClick={() => onDone(true)}>
                {o.planNow}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
