// Configurações → Folgas e férias (Fase 15): períodos marcados, feriados estaduais, personalizados e
// "trabalho nesse feriado".
import { useEffect, useState } from 'react';
import { parseDateRange, STATE_HOLIDAYS, type HolidayPrefs } from '@shared/holidays';
import type { DayKind, DayStatus } from '@shared/types';
import { Button } from '../components/Button';
import { Chip, Label, TextField } from '../components/Form';
import { IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';

const d = t.days;
const br = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const key = (x: Date): string => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/** Agrupa dias seguidos do mesmo tipo: 10..20/12 férias vira uma linha só. */
export function groupRanges(days: DayStatus[]): Array<{ start: string; end: string; kind: DayKind; note: string | null; source: string }> {
  const out: Array<{ start: string; end: string; kind: DayKind; note: string | null; source: string }> = [];
  for (const day of days) {
    const last = out[out.length - 1];
    const prev = last ? new Date(Number(last.end.slice(0, 4)), Number(last.end.slice(5, 7)) - 1, Number(last.end.slice(8, 10)) + 1) : null;
    if (last && last.kind === day.kind && last.source === day.source && prev && key(prev) === day.date) last.end = day.date;
    else out.push({ start: day.date, end: day.date, kind: day.kind, note: day.note, source: day.source });
  }
  return out;
}

export function DaysSettings({ onMsg }: { onMsg: (m: string) => void }): React.JSX.Element {
  const [days, setDays] = useState<DayStatus[]>([]);
  const [prefs, setPrefs] = useState<HolidayPrefs | null>(null);
  const [kind, setKind] = useState<DayKind>('vacation');
  const [period, setPeriod] = useState('');
  const [customName, setCustomName] = useState('');
  const [customDate, setCustomDate] = useState('');

  const today = key(new Date());
  const horizon = key(new Date(Date.now() + 120 * 86_400_000));
  const reload = async (): Promise<void> => {
    setDays(await api.invoke('days:list', today, horizon));
    setPrefs(await api.invoke('days:holidayPrefs'));
  };
  useEffect(() => {
    void reload();
  }, []);

  const add = async (): Promise<void> => {
    const r = parseDateRange(period);
    if (!r) return onMsg(d.notUnderstood);
    await api.invoke('days:setRange', r.start, r.end, kind, null);
    setPeriod('');
    onMsg(r.start === r.end ? d.markedOne(d.kinds[kind], br(r.start)) : d.markedRange(d.kinds[kind], br(r.start), br(r.end)));
    await reload();
  };

  const savePrefs = async (p: HolidayPrefs): Promise<void> => {
    setPrefs(await api.invoke('days:setHolidayPrefs', p));
    await reload();
  };

  const mine = groupRanges(days.filter((x) => x.source !== 'holiday'));
  const holidays = days.filter((x) => x.source === 'holiday').slice(0, 6);

  return (
    <div className="flex flex-col gap-[16px]">
      <section>
        <Label>{d.sectionUpcoming}</Label>
        {mine.length === 0 && <p className="text-[12px] text-fg-3">{d.noUpcoming}</p>}
        <div className="flex flex-col gap-[4px]">
          {mine.map((r) => (
            <div key={r.start} className="flex items-center gap-[8px] rounded-[8px] px-[8px] py-[5px] text-[12.5px]" style={{ background: 'var(--bg-card-hover)' }}>
              <span className="w-[86px] text-fg-2">{d.kinds[r.kind]}</span>
              <span className="mono flex-1 text-fg">{r.start === r.end ? br(r.start) : `${br(r.start)} – ${br(r.end)}`}</span>
              <button
                type="button"
                aria-label={d.remove}
                className="text-fg-3 hover:text-fg"
                onClick={async () => {
                  await api.invoke('days:clearRange', r.start, r.end);
                  await reload();
                }}
              >
                <IconX size={10} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
          {(['vacation', 'off', 'half', 'sick'] as const).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
              {d.kinds[k]}
            </Chip>
          ))}
        </div>
        <div className="mt-[6px] flex items-center gap-[6px]">
          <TextField value={period} onChange={setPeriod} placeholder={d.periodPlaceholder} className="w-[240px] text-[12px]" pinKey="days-period" ariaLabel={d.periodPlaceholder} />
          <Button size="sm" variant="primary" disabled={!period.trim()} onClick={() => void add()}>
            {d.add}
          </Button>
        </div>
      </section>

      {prefs && (
        <section>
          <Label>{d.holidays}</Label>
          <div className="flex items-center gap-[8px] text-[12px] text-fg-2">
            {d.state}
            <select
              aria-label={d.state}
              value={prefs.state ?? ''}
              onChange={(e) => void savePrefs({ ...prefs, state: e.target.value || null })}
              className="h-[26px] rounded-[8px] px-[8px] text-[12px] text-fg outline-none"
              style={{ background: 'var(--bg-input)' }}
            >
              <option value="">{d.noState}</option>
              {Object.keys(STATE_HOLIDAYS).map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>
          <p className="mb-[4px] mt-[10px] text-[11px] text-fg-3">{d.nextHolidays}</p>
          <div className="flex flex-col gap-[3px]">
            {holidays.map((h) => (
              <div key={h.date} className="flex items-center gap-[8px] text-[12.5px]">
                <span className="mono w-[44px] text-fg-2">{br(h.date)}</span>
                <span className="flex-1 truncate text-fg">{h.note}</span>
                <button type="button" className="text-[11px] text-fg-3 hover:text-fg" onClick={() => void savePrefs({ ...prefs, worked: [...prefs.worked, h.note ?? ''] })}>
                  {d.workThisOne}
                </button>
              </div>
            ))}
          </div>
          {prefs.worked.length > 0 && (
            <div className="mt-[8px] flex flex-wrap items-center gap-[6px] text-[11px] text-fg-3">
              {d.workedOnes}:
              {prefs.worked.map((w) => (
                <button key={w} type="button" className="rounded-full px-[8px] py-[1px] text-fg-2 hover:text-fg" style={{ background: 'var(--bg-card-hover)' }} onClick={() => void savePrefs({ ...prefs, worked: prefs.worked.filter((x) => x !== w) })}>
                  {w} ×
                </button>
              ))}
            </div>
          )}
          <p className="mb-[4px] mt-[12px] text-[11px] text-fg-3">{d.customHoliday}</p>
          {prefs.custom.map((c) => (
            <div key={`${c.date}${c.name}`} className="flex items-center gap-[8px] text-[12.5px]">
              <span className="mono w-[44px] text-fg-2">{c.date.length === 5 ? `${c.date.slice(3)}/${c.date.slice(0, 2)}` : br(c.date)}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <button type="button" aria-label={d.remove} className="text-fg-3 hover:text-fg" onClick={() => void savePrefs({ ...prefs, custom: prefs.custom.filter((x) => x !== c) })}>
                <IconX size={10} />
              </button>
            </div>
          ))}
          <div className="mt-[4px] flex items-center gap-[6px]">
            <TextField value={customDate} onChange={setCustomDate} placeholder={d.customDate} className="w-[120px] text-[12px]" pinKey="days-cdate" ariaLabel={d.customDate} />
            <TextField value={customName} onChange={setCustomName} placeholder={d.customName} className="w-[200px] text-[12px]" pinKey="days-cname" ariaLabel={d.customName} />
            <Button
              size="sm"
              disabled={!/^\d{1,2}\/\d{1,2}$/.test(customDate.trim()) || !customName.trim()}
              onClick={() => {
                const [dd, mm] = customDate.trim().split('/');
                void savePrefs({ ...prefs, custom: [...prefs.custom, { date: `${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, name: customName.trim() }] });
                setCustomDate('');
                setCustomName('');
              }}
            >
              {d.add}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
