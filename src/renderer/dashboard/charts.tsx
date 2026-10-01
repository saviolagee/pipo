// Gráficos dos dashboards em SVG (sem bibliotecas). Paleta validada para o tema escuro do Pipo
// (superfície #121214): ver scripts de validação na skill de dataviz. Marcas finas, cantos de 4px
// ancorados na base, 2px de espaço entre segmentos, tooltip em cada marca e tabela opcional.
import { useLayoutEffect, useRef, useState } from 'react';

/** Categóricas (ordem fixa, passam CVD no escuro). Os 3 primeiros passam em todos os pares. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;
/** Sequencial azul, escuro → claro (no fundo escuro, o claro é "mais"). */
export const SEQ = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'] as const;
export const EMPTY_CELL = '#1c1c20';
export const INK = { primary: '#f4f4f5', secondary: '#a1a1aa', muted: '#6b6b73', grid: 'rgba(255,255,255,0.06)', surface: '#121214' };

export function seqColor(v: number, max: number): string {
  if (v <= 0 || max <= 0) return EMPTY_CELL;
  const i = Math.min(SEQ.length - 1, Math.floor((v / max) * SEQ.length));
  return SEQ[i];
}

// ---------- Tooltip ----------

export interface Tip {
  x: number;
  y: number;
  lines: string[];
}

export function Tooltip({ tip }: { tip: Tip | null }): React.JSX.Element | null {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-[8px] px-[10px] py-[6px] text-[12px] leading-[1.45]"
      style={{ left: tip.x + 14, top: tip.y + 12, background: '#1f1f23', border: '1px solid rgba(255,255,255,0.1)', color: INK.primary, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'font-medium' : 'text-[11.5px]'} style={i === 0 ? undefined : { color: INK.secondary }}>
          {l}
        </div>
      ))}
    </div>
  );
}

export function useTip(): [Tip | null, (e: React.MouseEvent, lines: string[]) => void, () => void] {
  const [tip, setTip] = useState<Tip | null>(null);
  return [tip, (e, lines) => setTip({ x: e.clientX, y: e.clientY, lines }), () => setTip(null)];
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Barra com cantos de 4px só no topo (ancorada na base). */
function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x} ${y + h} V${y + rr} Q${x} ${y} ${x + rr} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h} Z`;
}

const hatchId = 'pipo-hatch';
export function Hatch(): React.JSX.Element {
  return (
    <defs>
      <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      </pattern>
    </defs>
  );
}

// ---------- Barras por dia (com linha da meta e segunda série empilhada) ----------

export interface BarDatum {
  key: string;
  label: string;
  /** Valores empilhados (série 0 embaixo). */
  values: number[];
  /** Linha de referência (meta). */
  ref?: number;
  /** Cor própria da barra inteira (ausência), com textura. */
  marker?: { color: string; label: string } | null;
  tip: string[];
}

export function BarChart({ data, colors, height = 190, fmt, refLabel, unit = 1 }: { data: BarDatum[]; colors: readonly string[]; height?: number; fmt: (v: number) => string; refLabel?: string; /** Passo "redondo" do eixo (ex.: 60 para horas). */ unit?: number }): React.JSX.Element {
  const [ref, w] = useWidth();
  const [tip, show, hide] = useTip();
  const padL = 40;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.values.reduce((a, b) => a + b, 0), d.ref ?? 0)));
  const ticks = niceTicks(max / unit).map((x) => x * unit);
  const top = ticks[ticks.length - 1];
  const plotH = height - padB - padT;
  const y = (v: number): number => padT + plotH - (v / top) * plotH;
  const n = Math.max(1, data.length);
  const band = (w - padL) / n;
  const bw = Math.max(2, Math.min(36, band * 0.62));
  const every = Math.ceil(n / Math.max(1, Math.floor((w - padL) / 44)));
  return (
    <div ref={ref} className="relative w-full">
      <svg width={w} height={height} role="img" aria-label="gráfico de barras">
        <Hatch />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(t)} y2={y(t)} stroke={INK.grid} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10.5} fill={INK.muted}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const total = d.values.reduce((a, b) => a + b, 0);
          return (
            <g key={d.key} onMouseMove={(e) => show(e, d.tip)} onMouseLeave={hide}>
              {/* alvo de hover maior que a barra */}
              <rect x={cx - band / 2} y={padT} width={band} height={plotH} fill="transparent" />
              {d.marker && total === 0 && (
                <g>
                  <path d={topRounded(cx - bw / 2, y(top * 0.18), bw, plotH - (y(top * 0.18) - padT))} fill={d.marker.color} opacity={0.35} />
                  <path d={topRounded(cx - bw / 2, y(top * 0.18), bw, plotH - (y(top * 0.18) - padT))} fill={`url(#${hatchId})`} />
                </g>
              )}
              {d.values.map((v, si) => {
                if (v <= 0) return null;
                const y0 = y(acc + v);
                const h = y(acc) - y0 - (acc > 0 ? 2 : 0);
                acc += v;
                const isTop = d.values.slice(si + 1).every((x) => x <= 0);
                return isTop ? <path key={si} d={topRounded(cx - bw / 2, y0, bw, Math.max(1, h))} fill={colors[si]} /> : <rect key={si} x={cx - bw / 2} y={y0} width={bw} height={Math.max(1, h)} fill={colors[si]} />;
              })}
              {d.ref !== undefined && d.ref > 0 && <line x1={cx - band * 0.46} x2={cx + band * 0.46} y1={y(d.ref)} y2={y(d.ref)} stroke={INK.secondary} strokeWidth={1.5} strokeDasharray="3 3" />}
              {i % every === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={10.5} fill={INK.muted}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={w} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.18)" />
      </svg>
      {refLabel && <span className="sr-only">{refLabel}</span>}
      <Tooltip tip={tip} />
    </div>
  );
}

export function niceTicks(max: number): number[] {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

// ---------- Linha (humor) ----------

export function LineChart({ points, height = 150, min = 0, max = 100, color = SERIES[0], fmtX }: { points: Array<{ x: string; y: number | null }>; height?: number; min?: number; max?: number; color?: string; fmtX: (x: string) => string }): React.JSX.Element {
  const [ref, w] = useWidth();
  const [tip, show, hide] = useTip();
  const padL = 32;
  const padB = 22;
  const padT = 10;
  const plotH = height - padB - padT;
  const n = Math.max(1, points.length - 1);
  const x = (i: number): number => padL + ((w - padL - 10) * i) / n;
  const y = (v: number): number => padT + plotH - ((v - min) / (max - min)) * plotH;
  const segs: string[] = [];
  let cur = '';
  // Dias sem dado (folga, fim de semana) não quebram a linha: ela liga os pontos que existem.
  points.forEach((p, i) => {
    if (p.y === null) return;
    cur += `${cur ? 'L' : 'M'}${x(i)} ${y(p.y)} `;
  });
  if (cur) segs.push(cur);
  const [hover, setHover] = useState<number | null>(null);
  const every = Math.ceil(points.length / Math.max(1, Math.floor((w - padL) / 50)));
  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={w}
        height={height}
        role="img"
        aria-label="gráfico de linha"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - padL) / (w - padL - 10)) * n)));
          setHover(i);
          const p = points[i];
          show(e, [fmtX(p.x), p.y === null ? 'sem dado' : `humor ${p.y}`]);
        }}
        onMouseLeave={() => {
          setHover(null);
          hide();
        }}
      >
        {[min, (min + max) / 2, max].map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(t)} y2={y(t)} stroke={INK.grid} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10.5} fill={INK.muted}>
              {t}
            </text>
          </g>
        ))}
        {segs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="rgba(255,255,255,0.25)" />}
        {points.map((p, i) =>
          p.y === null ? null : <circle key={i} cx={x(i)} cy={y(p.y)} r={hover === i ? 4.5 : 2.5} fill={color} stroke={INK.surface} strokeWidth={2} />,
        )}
        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={`l${i}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10.5} fill={INK.muted}>
              {fmtX(p.x)}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Barras horizontais ----------

export function HBars({ rows, fmt, max }: { rows: Array<{ key: string; label: string; value: number; color: string; extra?: string; tip?: string[] }>; fmt: (v: number) => string; max?: number }): React.JSX.Element {
  const [tip, show, hide] = useTip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-[6px]">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[140px_1fr_auto] items-center gap-[10px] text-[12px]" onMouseMove={(e) => show(e, r.tip ?? [r.label, fmt(r.value)])} onMouseLeave={hide}>
          <span className="truncate" style={{ color: INK.primary }} title={r.label}>
            {r.label}
          </span>
          <span className="relative h-[12px]">
            <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: r.color }} />
          </span>
          <span className="mono text-right text-[11.5px]" style={{ color: INK.secondary }}>
            {fmt(r.value)}
            {r.extra && <span style={{ color: INK.muted }}> · {r.extra}</span>}
          </span>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Mapa de calor do ano (estilo GitHub) ----------

export function YearHeatmap({ year, cells, fmt }: { year: number; cells: Map<string, { value: number; absence: { color: string; label: string } | null; tip: string[] }>; fmt: (v: number) => string }): React.JSX.Element {
  const [tip, show, hide] = useTip();
  const size = 12;
  const gap = 3;
  const jan1 = new Date(year, 0, 1);
  const offset = (jan1.getDay() + 6) % 7; // semana começa na segunda
  const days: Date[] = [];
  for (let d = new Date(jan1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const max = Math.max(1, ...[...cells.values()].map((c) => c.value));
  const weeks = Math.ceil((days.length + offset) / 7);
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const W = 28 + weeks * (size + gap);
  return (
    <div className="relative overflow-x-auto">
      <svg width={W} height={7 * (size + gap) + 22} role="img" aria-label={`horas trabalhadas por dia em ${year}`}>
        <Hatch />
        {['seg', '', 'qua', '', 'sex', '', ''].map((l, i) => (
          <text key={i} x={0} y={18 + i * (size + gap) + size - 2} fontSize={10} fill={INK.muted}>
            {l}
          </text>
        ))}
        {months.map((m, i) => {
          const first = new Date(year, i, 1);
          const idx = Math.floor((Math.round((first.getTime() - jan1.getTime()) / 86_400_000) + offset) / 7);
          return (
            <text key={m} x={28 + idx * (size + gap)} y={10} fontSize={10} fill={INK.muted}>
              {m}
            </text>
          );
        })}
        {days.map((d, i) => {
          const k = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const c = cells.get(k);
          const pos = i + offset;
          const x = 28 + Math.floor(pos / 7) * (size + gap);
          const y = 16 + (pos % 7) * (size + gap);
          const fill = c?.absence ? c.absence.color : seqColor(c?.value ?? 0, max);
          return (
            <g key={k} onMouseMove={(e) => show(e, c?.tip ?? [d.toLocaleDateString('pt-BR'), 'sem registro'])} onMouseLeave={hide}>
              <rect x={x} y={y} width={size} height={size} rx={2.5} fill={fill} />
              {c?.absence && <rect x={x} y={y} width={size} height={size} rx={2.5} fill={`url(#${hatchId})`} />}
            </g>
          );
        })}
      </svg>
      <div className="mt-[6px] flex flex-wrap items-center gap-[12px] text-[11px]" style={{ color: INK.secondary }}>
        <span className="flex items-center gap-[4px]">
          menos
          {[EMPTY_CELL, ...SEQ].map((c) => (
            <span key={c} className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: c }} />
          ))}
          mais ({fmt(max)})
        </span>
        <LegendSwatch color={SERIES[1]} label="folga, feriado ou doente" hatch />
        <LegendSwatch color={SERIES[2]} label="férias" hatch />
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

export function LegendSwatch({ color, label, hatch = false, line = false }: { color: string; label: string; hatch?: boolean; line?: boolean }): React.JSX.Element {
  return (
    <span className="flex items-center gap-[5px]">
      {line ? (
        <svg width="16" height="8">
          <line x1="0" x2="16" y1="4" y2="4" stroke={color} strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      ) : (
        <svg width="10" height="10">
          <Hatch />
          <rect width="10" height="10" rx="2.5" fill={color} />
          {hatch && <rect width="10" height="10" rx="2.5" fill="url(#pipo-hatch)" />}
        </svg>
      )}
      {label}
    </span>
  );
}

// ---------- Ritmo: dia da semana × hora ----------

export function RhythmHeatmap({ grid, fmt }: { grid: number[][]; fmt: (v: number) => string }): React.JSX.Element {
  const [tip, show, hide] = useTip();
  const [ref, w] = useWidth();
  const names = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const max = Math.max(1, ...grid.flat());
  const cw = Math.max(10, (w - 40) / 24 - 2);
  return (
    <div ref={ref} className="relative w-full">
      <svg width={w} height={7 * 22 + 20} role="img" aria-label="minutos trabalhados por dia da semana e hora">
        {order.map((wd, r) => (
          <g key={wd}>
            <text x={0} y={r * 22 + 15} fontSize={10.5} fill={INK.muted}>
              {names[r]}
            </text>
            {hours.map((h) => {
              const v = grid[wd]?.[h] ?? 0;
              return (
                <rect
                  key={h}
                  x={36 + h * (cw + 2)}
                  y={r * 22}
                  width={cw}
                  height={19}
                  rx={3}
                  fill={seqColor(v, max)}
                  onMouseMove={(e) => show(e, [`${names[r]} ${h}h–${h + 1}h`, fmt(v)])}
                  onMouseLeave={hide}
                />
              );
            })}
          </g>
        ))}
        {hours
          .filter((h) => h % 3 === 0)
          .map((h) => (
            <text key={h} x={36 + h * (cw + 2)} y={7 * 22 + 14} fontSize={10.5} fill={INK.muted}>
              {h}h
            </text>
          ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Funil (métricas declaradas com etapa) ----------

export function Funnel({ stages, color }: { stages: Array<{ label: string; value: number }>; color: string }): React.JSX.Element {
  const [tip, show, hide] = useTip();
  const top = Math.max(1, stages[0]?.value ?? 1);
  return (
    <div className="flex flex-col gap-[4px]">
      {stages.map((s, i) => {
        const conv = i > 0 && stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : null;
        return (
          <div key={s.label} className="grid grid-cols-[140px_1fr_96px] items-center gap-[10px] text-[12px]" onMouseMove={(e) => show(e, [s.label, `${s.value}`, ...(conv !== null ? [`${conv}% da etapa anterior`] : [])])} onMouseLeave={hide}>
            <span className="truncate" style={{ color: INK.primary }}>
              {s.label}
            </span>
            <span className="relative flex h-[18px] justify-center">
              <span className="h-full rounded-[4px]" style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: color, opacity: 1 - i * 0.14 }} />
            </span>
            <span className="mono text-right text-[11.5px]" style={{ color: INK.secondary }}>
              {s.value}
              {conv !== null && <span style={{ color: INK.muted }}> · {conv}%</span>}
            </span>
          </div>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Tabela (alternativa acessível a cada gráfico) ----------

export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }): React.JSX.Element {
  return (
    <div className="max-h-[260px] overflow-auto rounded-[8px]" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0" style={{ background: '#18181b' }}>
          <tr>
            {head.map((h) => (
              <th key={h} className="px-[10px] py-[6px] font-medium" style={{ color: INK.secondary }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {r.map((c, j) => (
                <td key={j} className={`px-[10px] py-[5px] ${typeof c === 'number' ? 'mono' : ''}`} style={{ color: INK.primary }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function toCsv(head: string[], rows: Array<Array<string | number | null>>): string {
  const esc = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(esc).join(';')).join('\n');
}
