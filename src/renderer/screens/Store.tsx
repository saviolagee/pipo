// Loja de Pipos: os Pipos prontos do catálogo e o formulário que instala (ou reconfigura) um deles.
import { useEffect, useState } from 'react';
import { PIPO_COLORS, pipoAccessoryLayers } from '@shared/pipos';
import type { StoreConfig, StoreField, StoreItem } from '@shared/team';
import { Button } from '../components/Button';
import { usePinOnFocus } from '../components/Form';
import { IconChevron } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { usePipos } from '../store/pipos';

const s = t.team.store;
const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const inputClass = 'w-full rounded-[10px] bg-[#1A1A1F] px-[12px] py-[7px] text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:bg-[#202026]';

function Field({ f, value, onChange, secretSet }: { f: StoreField; value: string; onChange: (v: string) => void; secretSet: boolean }): React.JSX.Element {
  const pin = usePinOnFocus(`store:${f.key}`);
  const common = { value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value), 'aria-label': f.label, className: inputClass, ...pin };
  return (
    <label className={`flex flex-col gap-[4px] ${f.kind === 'textarea' ? 'col-span-2' : ''}`}>
      <span className="flex items-baseline gap-[6px] text-[11px] font-medium text-fg-2">
        {f.label}
        {f.required && <span className="font-normal text-fg-3">{s.required}</span>}
      </span>
      {f.kind === 'textarea' ? (
        <textarea {...common} rows={2} placeholder={f.placeholder} className={`${inputClass} scroll-thin resize-none leading-[1.45]`} />
      ) : (
        <input {...common} type={f.kind === 'secret' ? 'password' : f.kind === 'number' ? 'number' : 'text'} autoComplete="off" spellCheck={false} placeholder={f.kind === 'secret' && secretSet ? s.secretSet : f.placeholder} />
      )}
      {f.help && <span className="text-[10.5px] leading-[1.35] text-fg-3">{f.help}</span>}
    </label>
  );
}

/** Formulário de um Pipo da loja: instalar (campos com o valor sugerido) ou configurar (com o que já está salvo). */
function StoreForm({ head, fields, start, secretsSet, submit, onSubmit, onBack }: { head: React.ReactNode; fields: StoreField[]; start: Record<string, string>; secretsSet: string[]; submit: string; onSubmit: (values: Record<string, string>) => Promise<string | null>; onBack: () => void }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, start[f.key] ?? f.initial ?? ''])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const missing = fields.some((f) => f.required && !values[f.key]?.trim());
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-[12px] pb-[10px]">
        <button type="button" onClick={onBack} aria-label={s.back} className="text-fg-2 hover:text-fg">
          <IconChevron size={10} dir="left" />
        </button>
        {head}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-[4px]">
        <div className="grid grid-cols-2 gap-x-[12px] gap-y-[10px]">
          {fields.map((f) => (
            <Field key={f.key} f={f} value={values[f.key] ?? ''} secretSet={secretsSet.includes(f.key)} onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-[10px] pt-[10px]">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-2" title={msg ?? undefined}>
          {msg}
        </span>
        <Button size="sm" variant="tertiary" onClick={onBack}>
          {t.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || missing}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              setMsg(await onSubmit(values));
            } catch (e) {
              setMsg(clean(e));
            }
            setBusy(false);
          }}
        >
          {submit}
        </Button>
      </div>
    </div>
  );
}

function ItemCard({ item, onInstall }: { item: StoreItem; onInstall: () => void }): React.JSX.Element {
  const color = PIPO_COLORS[item.color];
  const installed = usePipos((st) => st.list.find((p) => p.slug === item.installed));
  return (
    <div className="flex gap-[14px] rounded-[16px] p-[14px]" style={{ background: 'var(--bg-card)', border: `1px solid ${color}40` }}>
      <div className="flex w-[64px] shrink-0 flex-col items-center gap-[6px]">
        <Mascot state="idle" size={56} color={color} accessories={pipoAccessoryLayers(item.accessory)} glow={false} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-[8px]">
          <span className="text-[14px] font-semibold text-fg">{item.name}</span>
          <span className="truncate text-[12px] text-fg-2">{item.tagline}</span>
        </div>
        <ul className="mt-[6px] flex flex-col gap-[2px]">
          {item.does.map((d) => (
            <li key={d} className="flex gap-[6px] text-[11.5px] leading-[1.4] text-fg-2">
              <span style={{ color }}>•</span>
              {d}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-[6px]">
        {installed ? (
          <>
            <span className="text-[10.5px] text-fg-3">{s.installed}</span>
            <Button size="sm" onClick={() => usePipos.setState({ view: 'list', openId: installed.id, openRunId: null })}>
              {s.openInstalled}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={onInstall}>
            {s.install}
          </Button>
        )}
      </div>
    </div>
  );
}

export function StoreScreen(): React.JSX.Element {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [picked, setPicked] = useState<StoreItem | null>(null);
  const hired = usePipos((st) => st.list.length);
  useEffect(() => {
    void api.invoke('store:list').then(setItems);
  }, [hired]);
  const back = (): void => usePipos.setState({ view: 'list' });

  if (picked)
    return (
      <StoreForm
        head={
          <>
            <Mascot state="happy" size={40} color={PIPO_COLORS[picked.color]} accessories={pipoAccessoryLayers(picked.accessory)} glow={false} />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-fg">{picked.name}</div>
              <p className="truncate text-[11.5px] text-fg-2">{picked.tagline}</p>
            </div>
          </>
        }
        fields={picked.fields}
        start={{}}
        secretsSet={[]}
        submit={s.hire}
        onBack={() => setPicked(null)}
        onSubmit={async (values) => {
          const r = await api.invoke('store:install', picked.id, values);
          usePipos.setState({ view: 'list', openId: r.pipoId, openRunId: null });
          return null;
        }}
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-[12px] pb-[10px]">
        <button type="button" onClick={back} aria-label={s.back} className="text-fg-2 hover:text-fg">
          <IconChevron size={10} dir="left" />
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">{s.title}</div>
          <p className="truncate text-[11.5px] text-fg-2">{s.subtitle}</p>
        </div>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto pr-[4px]">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onInstall={() => setPicked(item)} />
        ))}
        <p className="px-[4px] pt-[4px] text-[11px] text-fg-3">{s.soon}</p>
      </div>
    </div>
  );
}

/** "Configurar" de um Pipo que veio da loja: os mesmos campos da instalação, com o que já está salvo. */
export function StoreConfigScreen({ pipoId, onBack }: { pipoId: number; onBack: () => void }): React.JSX.Element | null {
  const [cfg, setCfg] = useState<StoreConfig | null>(null);
  useEffect(() => {
    void api.invoke('store:config', pipoId).then((c) => (c ? setCfg(c) : onBack()));
  }, [pipoId]);
  if (!cfg) return null;
  return (
    <StoreForm
      key={pipoId}
      head={
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">
            {s.configure} · {cfg.name}
          </div>
        </div>
      }
      fields={cfg.fields}
      start={cfg.values}
      secretsSet={cfg.secretsSet}
      submit={s.save}
      onBack={onBack}
      onSubmit={async (values) => {
        setCfg(await api.invoke('store:saveConfig', pipoId, values));
        return s.saved;
      }}
    />
  );
}
