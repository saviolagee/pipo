// Peças comuns das telas de dashboard: cartão (com tabela alternativa), número de destaque e a
// diferença contra o período anterior.
import { useState } from 'react';
import { t } from '../i18n/pt-BR';
import { DataTable, INK } from './charts';

const d = t.dash;

/** Cores de estado (bom/ruim), sempre junto de uma seta ou rótulo. */
export const GOOD = '#4ADE80';
export const BAD = '#FCA5A5';

export function Card({ title, children, table, right, wide = false, grow = false }: { title: string; children: React.ReactNode; table?: { head: string[]; rows: Array<Array<string | number>> }; right?: React.ReactNode; wide?: boolean; /** Estica até a altura da linha (dentro de um contêiner flex). */ grow?: boolean }): React.JSX.Element {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`rounded-[14px] p-[16px] ${wide ? 'col-span-2' : ''} ${grow ? 'flex-1' : ''}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="mb-[12px] flex items-center gap-[10px]">
        <h2 className="text-[13px] font-semibold" style={{ color: INK.primary }}>
          {title}
        </h2>
        <span className="flex-1" />
        {right}
        {table && (
          <button type="button" onClick={() => setAsTable((v) => !v)} className="rounded-full px-[8px] py-[2px] text-[11px] hover:bg-white/[0.06]" style={{ color: INK.secondary }}>
            {asTable ? d.chart : d.table}
          </button>
        )}
      </div>
      {asTable && table ? <DataTable head={table.head} rows={table.rows} /> : children}
    </section>
  );
}

export function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: React.ReactNode; accent?: string }): React.JSX.Element {
  return (
    <div className="rounded-[14px] px-[16px] py-[12px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-[11.5px]" style={{ color: INK.secondary }}>
        {label}
      </div>
      <div className="mono mt-[2px] text-[24px] font-semibold leading-tight" style={{ color: accent ?? INK.primary }}>
        {value}
      </div>
      {sub && (
        <div className="mt-[2px] text-[11px]" style={{ color: INK.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** Diferença contra o período anterior: seta e número; a cor diz se a direção é boa. */
export function Delta({ now, prev, upIsGood = true, fmt = String, vs }: { now: number; prev: number; upIsGood?: boolean; fmt?: (v: number) => string; vs?: string }): React.JSX.Element | null {
  if (!now && !prev) return null;
  const diff = now - prev;
  const color = diff === 0 ? INK.muted : diff > 0 === upIsGood ? GOOD : BAD;
  return (
    <span>
      <span style={{ color }}>
        {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {diff === 0 ? d.pipo.same : fmt(Math.abs(diff))}
      </span>
      {vs && <span style={{ color: INK.muted }}> {d.pipo.vs(vs)}</span>}
    </span>
  );
}
