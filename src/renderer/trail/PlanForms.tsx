import { useState } from 'react';
import { fmtDay, type Goal } from '@shared/trail';
import { Button } from '../components/Button';
import { Chip, Label, TextField, usePinOnFocus } from '../components/Form';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { useGoals } from '../store/goals';
import { askPipo } from './actions';

const tt = t.trail;

function DateField({ value, min, onChange, label }: { value: string; min?: string; onChange: (v: string) => void; label: string }): React.JSX.Element {
  const pin = usePinOnFocus('trail-date');
  return (
    <input
      type="date"
      aria-label={label}
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      {...pin}
      className="mono h-[32px] w-[150px] rounded-[10px] px-[10px] text-[13px] outline-none [color-scheme:dark] focus:ring-1 focus:ring-white/30"
      style={{ background: 'var(--bg-input)' }}
    />
  );
}

/** Plano novo: o resultado e a data. O Pipo desmembra pelo chat, ou o usuário monta a trilha à mão. */
export function NewPlan({ today, onClose }: { today: string; onClose: (() => void) | null }): React.JSX.Element {
  const [outcome, setOutcome] = useState('');
  const [date, setDate] = useState('');
  const ready = outcome.trim().length > 0;

  const withPipo = (): void => {
    if (!ready) return;
    askPipo(tt.askPrompt(outcome.trim(), date || null), true);
    onClose?.();
  };
  const byHand = async (): Promise<void> => {
    if (!ready) return;
    const g = await api.invoke('goals:create', { title: outcome.trim(), outcome: outcome.trim(), targetDate: date || null });
    useGoals.getState().select(g.id);
    onClose?.();
  };

  return (
    <div className="rounded-[16px] px-[16px] py-[14px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <p className="mb-[12px] text-[12.5px] text-fg-2">{tt.intro}</p>
      <div className="flex items-end gap-[10px]">
        <div className="min-w-0 flex-1">
          <Label>{tt.outcome}</Label>
          <TextField value={outcome} onChange={setOutcome} onEnter={withPipo} autoFocus placeholder={tt.outcomePh} className="w-full" pinKey="trail-outcome" />
        </div>
        <div>
          <Label>{tt.when}</Label>
          <DateField value={date} min={today} onChange={setDate} label={tt.when} />
        </div>
      </div>
      <div className="mt-[12px] flex items-center justify-end gap-[8px]">
        {onClose && (
          <Button size="sm" variant="tertiary" onClick={onClose}>
            {tt.cancel}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={!ready} onClick={() => void byHand()}>
          {tt.byHand}
        </Button>
        <Button size="sm" variant="primary" disabled={!ready} onClick={withPipo}>
          {tt.askPipo}
        </Button>
      </div>
    </div>
  );
}

/** Ajustes do plano: nome, resultado, data desejada, dias da semana, arquivar e apagar. */
export function GoalSettings({ goal, today, onClose }: { goal: Goal; today: string; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(goal.title);
  const [outcome, setOutcome] = useState(goal.outcome);
  const [date, setDate] = useState(goal.targetDate ?? '');
  const [weekdays, setWeekdays] = useState(goal.weekdays);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (): Promise<void> => {
    await api.invoke('goals:update', goal.id, { title, outcome, targetDate: date || null, weekdays });
    onClose();
  };
  const toggle = (d: number): void => {
    const next = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort();
    // Sem nenhum dia o plano não anda: mantém pelo menos um.
    if (next.length) setWeekdays(next);
  };

  return (
    <div className="rounded-[16px] px-[16px] py-[14px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-end gap-[10px]">
        <div className="min-w-0 flex-1">
          <Label>{tt.name}</Label>
          <TextField value={title} onChange={setTitle} className="w-full" pinKey="trail-name" />
        </div>
        <div>
          <Label hint={goal.targetDate ? fmtDay(goal.targetDate, today) : undefined}>{tt.targetDate}</Label>
          <DateField value={date} onChange={setDate} label={tt.targetDate} />
        </div>
      </div>
      <div className="mt-[10px]">
        <Label>{tt.outcomeLabel}</Label>
        <TextField value={outcome} onChange={setOutcome} className="w-full" pinKey="trail-outcome-edit" />
      </div>
      <div className="mt-[10px]">
        <Label>{tt.weekdays}</Label>
        <div className="flex gap-[4px]">
          {tt.weekdayLetters.map((letter, d) => (
            <Chip key={tt.weekdayNames[d]} on={weekdays.includes(d)} onClick={() => toggle(d)} label={tt.weekdayNames[d]}>
              {letter}
            </Chip>
          ))}
        </div>
      </div>
      <div className="mt-[14px] flex items-center gap-[8px]">
        <Button
          size="sm"
          variant="tertiary"
          onClick={() => {
            void api.invoke('goals:update', goal.id, { status: 'archived' });
            onClose();
          }}
        >
          {tt.archive}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          className={confirmDelete ? '!text-[var(--status-attention)]' : ''}
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            void api.invoke('goals:delete', goal.id);
            onClose();
          }}
        >
          {confirmDelete ? tt.deleteConfirm : tt.delete}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="tertiary" onClick={onClose}>
          {tt.cancel}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          {tt.save}
        </Button>
      </div>
    </div>
  );
}
