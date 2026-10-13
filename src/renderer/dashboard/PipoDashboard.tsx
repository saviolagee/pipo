// Painel de um Pipo na janela de dashboards: os cartões saem das métricas do plano dele, e o
// usuário escolhe a ordem, o que aparece e qual número fica em destaque ("Personalizar").
import { useEffect, useState } from 'react';
import { normalizePipoConfig, packPipoCards, type DashRange, type PipoCardId, type PipoDash, type PipoDashConfig } from '@shared/dashboard';
import { PIPO_COLORS, pipoAccessoryLayers, type PipoAccessory, type PipoColor } from '@shared/pipos';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { INK, SERIES } from './charts';
import { Compare, Failures, FunnelCard, funnelTable, Outputs, OverTime, overTimeTable, overTimeTitle, prevLabel, Results, stagesOf, Status, Timeline, timelineTable } from './PipoCards';
import { Card } from './ui';

const p = t.dash.pipo;

/** Cartões que fazem sentido para este Pipo neste período (funil só com etapas; gráfico só com 2+ dias). */
function available(data: PipoDash): PipoCardId[] {
  return data.config.order.filter((id) => (id === 'funnel' ? stagesOf(data).length >= 2 : id === 'overTime' ? data.days.length >= 2 : true));
}

function Tool({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-full px-[8px] py-[2px] text-[11px] hover:bg-white/[0.06] disabled:opacity-30" style={{ color: INK.secondary }}>
      {children}
    </button>
  );
}

export function PipoDashboard({ pipoId, range, onBack, onData }: { pipoId: number; range: DashRange; onBack: () => void; onData?: (d: PipoDash | null) => void }): React.JSX.Element | null {
  // undefined: carregando; null: o Pipo não existe mais.
  const [data, setData] = useState<PipoDash | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const load = async (): Promise<void> => {
    const next = await api.invoke('dash:pipo', pipoId, range);
    setData(next);
    onData?.(next);
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [pipoId, range]);

  if (data === undefined) return null;
  if (data === null)
    return (
      <p className="text-[13px]" style={{ color: INK.muted }}>
        {p.notFound} <Tool onClick={onBack}>‹ {p.back}</Tool>
      </p>
    );

  const color = PIPO_COLORS[data.pipo.color as PipoColor] ?? SERIES[0];
  const cards = available(data);
  const visible = cards.filter((id) => !data.config.hidden.includes(id));
  const hidden = cards.filter((id) => data.config.hidden.includes(id));
  const titles: Record<string, string> = { ...p.cards, overTime: overTimeTitle(data), compare: p.compareTitle(prevLabel(data)) };
  const save = async (config: PipoDashConfig): Promise<void> => {
    await api.invoke('dash:setPipoConfig', pipoId, config);
    await load();
  };
  /** Troca de lugar com o vizinho visível (os ocultos ficam onde estão). */
  const move = (id: PipoCardId, dir: -1 | 1): void => {
    const other = visible[visible.indexOf(id) + dir];
    if (!other) return;
    void save({ ...data.config, order: data.config.order.map((x) => (x === id ? other : x === other ? id : x)) });
  };
  const body = (id: PipoCardId): React.JSX.Element => {
    if (id === 'results') return <Results data={data} color={color} />;
    if (id === 'overTime') return <OverTime data={data} />;
    if (id === 'compare') return <Compare data={data} />;
    if (id === 'funnel') return <FunnelCard data={data} color={color} />;
    if (id === 'failures') return <Failures data={data} />;
    if (id === 'outputs') return <Outputs data={data} />;
    return <Timeline data={data} />;
  };
  const table = (id: PipoCardId): { head: string[]; rows: Array<Array<string | number>> } | undefined =>
    id === 'overTime' ? overTimeTable(data) : id === 'funnel' ? funnelTable(data) : id === 'timeline' && data.runs.length ? timelineTable(data) : undefined;

  return (
    <div>
      <div className="mb-[14px] flex items-center gap-[12px]">
        <Tool onClick={onBack}>‹ {p.back}</Tool>
        <Mascot state={data.pipo.paused ? 'sleepy' : 'idle'} size={40} color={color} accessories={pipoAccessoryLayers(data.pipo.accessory as PipoAccessory)} glow={false} still />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[8px]">
            <h2 className="text-[16px] font-semibold" style={{ color: INK.primary }}>
              {data.pipo.name}
            </h2>
            <span className="mono text-[11px]" style={{ color: INK.muted }}>
              @{data.pipo.slug}
              {data.pipo.version ? ` · v${data.pipo.version}` : ''}
            </span>
            {data.pipo.paused && (
              <span className="rounded-full px-[7px] text-[11px]" style={{ background: 'rgba(255,255,255,0.08)', color: INK.secondary }}>
                {p.paused}
              </span>
            )}
          </div>
          <p className="truncate text-[12.5px]" style={{ color: INK.secondary }}>
            {data.pipo.mission}
          </p>
        </div>
        {editing && data.metrics.length > 1 && (
          <label className="flex items-center gap-[6px] text-[11.5px]" style={{ color: INK.secondary }}>
            {p.headline}
            <select
              value={data.metrics.find((m) => m.headline)?.key ?? ''}
              onChange={(e) => void save({ ...data.config, headline: e.target.value })}
              className="h-[26px] rounded-[8px] px-[6px] text-[12px] outline-none"
              style={{ background: '#1c1c20', color: INK.primary }}
            >
              {data.metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {editing && <Tool onClick={() => void save(normalizePipoConfig(null))}>{p.reset}</Tool>}
        <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full px-[12px] py-[4px] text-[12px]" style={{ background: editing ? '#2A2A2E' : 'rgba(255,255,255,0.08)', color: INK.primary }}>
          {editing ? p.doneCustomizing : p.customize}
        </button>
      </div>

      {editing && hidden.length > 0 && (
        <div className="mb-[12px] flex flex-wrap items-center gap-[6px] text-[11.5px]" style={{ color: INK.secondary }}>
          {p.hidden}
          {hidden.map((id) => (
            <button key={id} type="button" onClick={() => void save({ ...data.config, hidden: data.config.hidden.filter((x) => x !== id) })} className="rounded-full px-[10px] py-[2px] hover:bg-white/[0.1]" style={{ background: 'rgba(255,255,255,0.06)', color: INK.primary }}>
              + {titles[id]}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-[14px]">
        {packPipoCards(visible).map(({ id, wide }) => (
          <div key={id} className={`flex min-w-0 flex-col ${wide ? 'col-span-2' : ''}`}>
            {editing && (
              <div className="mb-[4px] flex items-center gap-[2px] text-[11px]" style={{ color: INK.muted }}>
                {id === 'status' && titles[id]}
                <span className="flex-1" />
                <Tool onClick={() => move(id, -1)} disabled={visible[0] === id}>
                  ↑ {p.up}
                </Tool>
                <Tool onClick={() => move(id, 1)} disabled={visible[visible.length - 1] === id}>
                  ↓ {p.down}
                </Tool>
                <Tool onClick={() => void save({ ...data.config, hidden: [...data.config.hidden, id] })}>{p.hide}</Tool>
              </div>
            )}
            {id === 'status' ? (
              <Status data={data} />
            ) : (
              <Card title={titles[id]} table={table(id)} grow>
                {body(id)}
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
