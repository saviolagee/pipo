import { PRESENCE_BUDGET } from '@shared/config';
import type { PresenceLevel } from '@shared/types';
import { Label, Option, YesNo } from '../../components/Form';
import { t } from '../../i18n/pt-BR';
import { setProfile, type StepProps } from '../draft';

const o = t.onboarding;

export function PersonalityStep({ draft, set }: StepProps): React.JSX.Element {
  const levels: PresenceLevel[] = ['quiet', 'balanced', 'present'];
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid grid-cols-3 gap-[8px]">
        {levels.map((l) => (
          <Option
            key={l}
            on={draft.profile.presenceLevel === l}
            onClick={() => set(setProfile({ presenceLevel: l, interruptBudget: PRESENCE_BUDGET[l] }))}
            title={o.presence[l].title}
            desc={o.presence[l].desc}
          />
        ))}
      </div>
      <div className="flex items-center gap-[10px]">
        <Label>{o.tone}</Label>
        <YesNo value={draft.profile.tone === 'cute'} onChange={(cute) => set(setProfile({ tone: cute ? 'cute' : 'direct' }))} yes={o.toneCute} no={o.toneDirect} />
      </div>
    </div>
  );
}

export function AutostartStep({ draft, set }: StepProps): React.JSX.Element {
  return <YesNo value={draft.profile.autostart} onChange={(autostart) => set(setProfile({ autostart }))} />;
}
