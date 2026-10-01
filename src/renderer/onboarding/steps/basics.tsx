import type { EnergyPeak, FocusPreset, Weekday } from '@shared/types';
import { Chip, Label, NumberField, Option, Slider, TextField, TimeField, YesNo } from '../../components/Form';
import { t } from '../../i18n/pt-BR';
import { fmtGoal, PRESETS, setProfile, type StepProps } from '../draft';

const o = t.onboarding;
const DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function NameStep({ draft, set, onEnter }: StepProps & { onEnter?: () => void }): React.JSX.Element {
  return (
    <TextField
      autoFocus
      value={draft.profile.name}
      onChange={(name) => set(setProfile({ name }))}
      placeholder={o.namePlaceholder}
      onEnter={onEnter}
      className="w-full max-w-[300px] text-[15px]"
      pinKey="name"
    />
  );
}

export function RoutineStep({ draft, set }: StepProps): React.JSX.Element {
  const p = draft.profile;
  const toggleDay = (d: Weekday): void =>
    set(setProfile({ workDays: p.workDays.includes(d) ? p.workDays.filter((x) => x !== d) : ([...p.workDays, d].sort() as Weekday[]) }));
  return (
    <div className="flex flex-col gap-[12px]">
      <div>
        <Label>{o.workDays}</Label>
        <div className="flex flex-wrap gap-[5px]">
          {DAYS.map((d) => (
            <Chip key={d} on={p.workDays.includes(d)} onClick={() => toggleDay(d)}>
              {t.weekdaysShort[d]}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-[18px]">
        <div>
          <Label>{o.start}</Label>
          <TimeField ariaLabel={o.start} value={p.startTime} onChange={(startTime) => set(setProfile({ startTime }))} />
        </div>
        <div>
          <Label>{o.end}</Label>
          <TimeField ariaLabel={o.end} value={p.endTime} onChange={(endTime) => set(setProfile({ endTime }))} />
        </div>
        <div>
          <Label>{o.lunch}</Label>
          <TimeField ariaLabel={o.lunch} value={p.lunchStart} onChange={(lunchStart) => set(setProfile({ lunchStart }))} />
        </div>
        <div>
          <Label>{o.lunchDuration}</Label>
          <NumberField ariaLabel={o.lunchDuration} value={p.lunchMin} min={0} max={180} suffix={t.common.min} onChange={(lunchMin) => set(setProfile({ lunchMin }))} />
        </div>
      </div>
    </div>
  );
}

export function GoalStep({ draft, set }: StepProps): React.JSX.Element {
  const p = draft.profile;
  const perDay = p.goalPerDay !== null;
  const togglePerDay = (on: boolean): void => {
    if (!on) return set(setProfile({ goalPerDay: null }));
    const map: Partial<Record<Weekday, number>> = {};
    for (const d of DAYS) map[d] = p.workDays.includes(d) ? p.dailyGoalMin : 0;
    set(setProfile({ goalPerDay: map }));
  };
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[14px]">
        <Slider ariaLabel={o.goalSay} min={60} max={720} step={30} value={p.dailyGoalMin} onChange={(dailyGoalMin) => set(setProfile({ dailyGoalMin }))} />
        <span className="mono w-[56px] shrink-0 text-right text-[20px] font-semibold">{fmtGoal(p.dailyGoalMin)}</span>
      </div>
      <p className="text-[12px] text-fg-2">{o.goalHint}</p>
      <div className="flex items-center gap-[10px]">
        <span className="text-[12px] text-fg-2">{o.goalPerDay}</span>
        <YesNo value={perDay} onChange={togglePerDay} />
      </div>
      {perDay && (
        <div className="grid grid-cols-2 gap-x-[16px] gap-y-[4px]">
          {DAYS.map((d) => {
            const v = p.goalPerDay?.[d] ?? 0;
            return (
              <div key={d} className="flex items-center gap-[8px]">
                <span className="w-[28px] text-[11px] text-fg-2">{t.weekdaysShort[d]}</span>
                <Slider ariaLabel={`${o.goalPerDay} ${t.weekdaysShort[d]}`} min={0} max={720} step={30} value={v} onChange={(nv) => set(setProfile({ goalPerDay: { ...p.goalPerDay, [d]: nv } }))} />
                <span className="mono w-[40px] text-right text-[11px]">{v ? fmtGoal(v) : '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EnergyStep({ draft, set }: StepProps): React.JSX.Element {
  const ids: EnergyPeak[] = ['morning', 'afternoon', 'evening', 'varies'];
  return (
    <div className="grid grid-cols-2 gap-[8px]">
      {ids.map((id) => (
        <Option key={id} on={draft.profile.energyPeak === id} onClick={() => set(setProfile({ energyPeak: id }))} title={o.energy[id].title} desc={o.energy[id].desc} />
      ))}
    </div>
  );
}

export function FocusStep({ draft, set }: StepProps): React.JSX.Element {
  const fp = draft.profile.focusPreset;
  const ids: FocusPreset['id'][] = ['p25', 'p50', 'deep90', 'custom'];
  const pick = (id: FocusPreset['id']): void => set(setProfile({ focusPreset: id === 'custom' ? { ...fp, id: 'custom' } : { ...PRESETS[id] } }));
  const patch = (k: keyof Omit<FocusPreset, 'id'>, v: number): void => set(setProfile({ focusPreset: { ...fp, id: 'custom', [k]: v } }));
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-2 gap-[8px]">
        {ids.map((id) => (
          <Option key={id} on={fp.id === id} onClick={() => pick(id)} title={o.presets[id].title} desc={o.presets[id].desc} />
        ))}
      </div>
      {fp.id === 'custom' && (
        <div className="flex flex-wrap gap-[14px]">
          <NumberField ariaLabel={o.focusMin} value={fp.focusMin} min={5} max={180} suffix={`${t.common.min} ${o.focusMin.toLowerCase()}`} onChange={(v) => patch('focusMin', v)} />
          <NumberField ariaLabel={o.breakMin} value={fp.breakMin} min={1} max={60} suffix={`${t.common.min} ${o.breakMin.toLowerCase()}`} onChange={(v) => patch('breakMin', v)} />
          <NumberField ariaLabel={o.longBreakMin} value={fp.longBreakMin} min={1} max={90} suffix={`${t.common.min} ${o.longBreakMin.toLowerCase()}`} onChange={(v) => patch('longBreakMin', v)} />
          <NumberField ariaLabel={o.cycles} value={fp.cycles} min={1} max={12} suffix={o.cycles.toLowerCase()} onChange={(v) => patch('cycles', v)} />
        </div>
      )}
    </div>
  );
}
