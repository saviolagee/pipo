// Aba Equipe: os Pipos coloridos do usuário. Nenhum vem instalado; o convite leva ao /criarpipo.
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { MiniPipo } from '../mascot/MiniPipo';
import { PIPO_COLORS, pipoAccessoryLayers, type PipoSummary } from '@shared/pipos';
import { IconPlay } from '../components/Icons';
import { api } from '../lib/api';
import { fmtWhen, PipoDetail } from './PipoDetail';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { Mascot } from '../mascot/Mascot';
import { useChat } from '../store/chat';
import { usePipos } from '../store/pipos';
import { useUi } from '../store/ui';

const tt = t.team;

/** Importa um .pipo e já abre a criação a partir dele (pede as chaves e ensaia antes de contratar). */
export async function importPipoFile(): Promise<void> {
  try {
    const r = await api.invoke('pipos:importFile', null);
    if (!r) return;
    const d = await api.invoke('pipos:startDraft', { fromModelId: r.modelId });
    useUi.getState().setTab('chat');
    await useChat.getState().openConversation(d.conversationId);
    await useChat.getState().send(tt.importedMsg(r.name, r.secrets));
  } catch (e) {
    useUi.getState().pushToast({ id: `imp:${Date.now()}`, text: (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), durationMs: 6000 });
  }
}

export function startCreatePipo(): void {
  useUi.getState().setTab('chat');
  useChat.getState().newConversation();
  void useChat.getState().send('/criarpipo');
}

function EmptyTeam(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[10px] text-center">
      <div className="flex items-end gap-[6px] opacity-90">
        <Mascot state="idle" size={34} color={PIPO_COLORS.orange} glow={false} still />
        <Mascot state="happy" size={46} glow={false} />
        <Mascot state="idle" size={34} color={PIPO_COLORS.blue} glow={false} still />
      </div>
      <p className="text-[14px] font-semibold text-fg">{tt.emptyTitle}</p>
      <p className="max-w-[380px] text-[12.5px] text-fg-2">{tt.emptyBody}</p>
      <Button variant="primary" onClick={startCreatePipo}>
        {tt.create}
      </Button>
    </div>
  );
}

type Edge = { from: number; to: number; kind: 'after' | 'handoff'; delayMin: number };

const delayLabel = (m: number): string => (m <= 0 ? '' : m >= 1440 ? ` +${Math.round(m / 1440)}d` : m >= 60 ? ` +${Math.round(m / 60)}h` : ` +${m}min`);

/** Mapa simples das conexões: quem roda depois de quem e quem entrega para quem. */
function LinksMap({ list, edges }: { list: PipoSummary[]; edges: Edge[] }): React.JSX.Element | null {
  if (!edges.length) return <p className="px-[4px] pt-[10px] text-[11px] text-fg-3">{tt.linkHint}</p>;
  const byId = new Map(list.map((p) => [p.id, p]));
  return (
    <div className="mt-[10px] rounded-[12px] px-[10px] py-[8px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="mb-[4px] text-[10.5px] font-medium uppercase tracking-[0.05em] text-fg-3">{tt.links}</div>
      <div className="flex flex-wrap gap-x-[16px] gap-y-[4px]">
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <span key={i} className="flex items-center gap-[5px] text-[11.5px] text-fg-2">
              <MiniPipo color={PIPO_COLORS[a.color]} state={a.live.state === 'idle' ? 'done' : a.live.state} size={12} title={a.name} />
              {a.name}
              <span className="text-fg-3">{e.kind === 'handoff' ? '⇢' : '→'}</span>
              <MiniPipo color={PIPO_COLORS[b.color]} state={b.live.state === 'idle' ? 'done' : b.live.state} size={12} title={b.name} />
              {b.name}
              <span className="mono text-[10px] text-fg-3">{e.kind === 'handoff' ? 'entrega' : delayLabel(e.delayMin)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function PipoCard({ p, onOpen }: { p: PipoSummary; onOpen: () => void }): React.JSX.Element {
  const color = PIPO_COLORS[p.color];
  const working = p.live.state === 'working' || p.live.state === 'waiting';
  const status = working
    ? (p.live.stepLabel ?? '…')
    : !p.activeVersion
      ? tt.noPlan.split('.')[0]
      : [p.lastRun ? `${p.lastRun.status === 'failed' ? '✕' : '✓'} ${tt.lastRun(fmtWhen(p.lastRun.startedAt))}` : null, p.nextRunAt ? tt.nextRun(fmtWhen(p.nextRunAt)) : null].filter(Boolean).join(' · ') || p.personality.mission;
  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      draggable={!!p.activeVersion}
      onDragStartCapture={(e: React.DragEvent) => {
        e.dataTransfer.setData('pipo/id', String(p.id));
        e.dataTransfer.effectAllowed = 'link';
      }}
      onDragOver={(e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('pipo/id')) e.preventDefault();
      }}
      onDrop={(e: React.DragEvent) => {
        const from = Number(e.dataTransfer.getData('pipo/id'));
        if (from && from !== p.id) usePipos.setState({ pendingLink: { from, to: p.id } });
      }}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex min-w-0 cursor-default items-center gap-[10px] rounded-[14px] p-[10px] text-left transition-colors hover:bg-white/[0.06]"
      style={{ background: working ? `${color}12` : 'var(--bg-card)', border: `1px solid ${working ? `${color}66` : 'var(--border-subtle)'}` }}
    >
      <Mascot state={working ? 'working' : p.paused ? 'sleepy' : p.live.state === 'error' ? 'sad' : 'idle'} size={36} color={color} accessories={pipoAccessoryLayers(p.accessory)} glow={working} still={!working} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[6px] text-[13px] font-semibold text-fg">
          <span className="truncate">{p.name}</span>
          {p.paused && <span className="text-[10.5px] font-normal text-fg-3">{tt.paused}</span>}
        </span>
        <span className={`block truncate text-[11.5px] ${p.live.state === 'error' ? 'text-[#FCA5A5]' : 'text-fg-2'}`}>{status}</span>
      </span>
      {p.activeVersion && !working && (
        <button
          type="button"
          aria-label={`${tt.run} ${p.name}`}
          title={`${tt.run} ${p.name}`}
          onClick={(e) => {
            e.stopPropagation();
            void api.invoke('pipos:run', p.id, { trigger: 'manual' });
          }}
          className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: color, color: '#0A0A0B' }}
        >
          <IconPlay size={8} />
        </button>
      )}
    </motion.div>
  );
}

/** "Rodar o B depois do A?" ao soltar um Pipo sobre outro. */
function LinkChooser({ list, pending, onDone }: { list: PipoSummary[]; pending: { from: number; to: number }; onDone: () => void }): React.JSX.Element {
  const a = list.find((p) => p.id === pending.from);
  const b = list.find((p) => p.id === pending.to);
  const [err, setErr] = useState<string | null>(null);
  const close = (): void => usePipos.setState({ pendingLink: null });
  const link = async (min: number): Promise<void> => {
    try {
      await api.invoke('pipos:link', pending.from, pending.to, min);
      close();
      onDone();
    } catch (e) {
      setErr((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  return (
    <div className="mb-[8px] flex flex-wrap items-center gap-[6px] rounded-[12px] px-[10px] py-[8px] text-[12px]" style={{ background: 'var(--bg-card-hover)' }}>
      <span className="mr-[4px] text-fg">{err ?? tt.linkAsk(a?.name ?? '', b?.name ?? '')}</span>
      {!err &&
        ([
          [0, tt.linkNow],
          [60, tt.link1h],
          [1440, tt.link1d],
          [4320, tt.link3d],
        ] as const).map(([m, label]) => (
          <Button key={m} size="sm" variant={m === 0 ? 'primary' : 'secondary'} onClick={() => void link(m)}>
            {label}
          </Button>
        ))}
      <Button size="sm" variant="tertiary" onClick={close}>
        {t.common.cancel}
      </Button>
    </div>
  );
}

export function TeamScreen(): React.JSX.Element {
  const list = usePipos((s) => s.list);
  const loaded = usePipos((s) => s.loaded);
  const openId = usePipos((s) => s.openId);
  const pending = usePipos((s) => s.pendingLink);
  const open = list.find((p) => p.id === openId) ?? null;
  const [edges, setEdges] = useState<Edge[]>([]);
  const reloadEdges = (): void => void api.invoke('pipos:links').then(setEdges);
  useEffect(reloadEdges, [list]);
  return (
    <div className="flex h-[372px] flex-col px-[12px] pb-[12px]">
      {open ? (
        <PipoDetail p={open} onBack={() => usePipos.getState().open(null)} />
      ) : loaded && list.length === 0 ? (
        <EmptyTeam />
      ) : (
        <>
          <div className="flex items-center justify-between px-[4px] pb-[8px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{tt.title(list.length)}</span>
            <span className="flex gap-[6px]">
              <Button size="sm" variant="tertiary" onClick={() => void importPipoFile()}>
                {tt.importPipo}
              </Button>
              <Button size="sm" onClick={startCreatePipo}>
                + {tt.create}
              </Button>
            </span>
          </div>
          {pending && <LinkChooser list={list} pending={pending} onDone={reloadEdges} />}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div className="grid auto-rows-min grid-cols-2 gap-[8px]">
              {list.map((p) => (
                <PipoCard key={p.id} p={p} onOpen={() => usePipos.getState().open(p.id)} />
              ))}
            </div>
            <LinksMap list={list} edges={edges} />
          </div>
        </>
      )}
    </div>
  );
}
