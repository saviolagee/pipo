// Detalhe de um Pipo colorido na aba Equipe: identidade, ações, plano, gatilhos, execuções (linha do
// tempo), regras aprendidas e segredos.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { describePlaybook } from '@shared/plan-check';
import { PIPO_ACCESSORY_NAMES, PIPO_COLORS, pipoAccessoryLayers, type PipoAccessory, type PipoColor, type PipoMemoryRule, type PipoRun, type PipoRunStep, type PipoSummary, type PipoTrigger, type PipoVersion } from '@shared/pipos';
import { Button } from '../components/Button';
import { IconChevron, IconPlay, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useChat } from '../store/chat';
import { usePipos } from '../store/pipos';
import { useUi } from '../store/ui';

const tt = t.team;

interface Detail {
  versions: PipoVersion[];
  triggers: PipoTrigger[];
  runs: PipoRun[];
  memory: PipoMemoryRule[];
  secrets: string[];
}

export function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoje ${hm}`;
  if (tomorrow) return `amanhã ${hm}`;
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hm}`;
}

const dur = (a: string | null, b: string | null): string => {
  if (!a || !b) return '';
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
};

const STATUS_ICON: Record<PipoRunStep['status'], string> = { pending: '·', running: '⟳', done: '✓', failed: '✕', skipped: '–', waiting: '…' };
const STATUS_COLOR: Record<PipoRunStep['status'], string> = { pending: '#52525B', running: '#F4F4F5', done: '#22C55E', failed: '#EF4444', skipped: '#71717A', waiting: '#F59E0B' };

/** Linha do tempo vertical de uma execução (✓ / ⟳ / ✕), com duração e saída resumida. */
export function RunTimeline({ runId, color, onBack }: { runId: number; color: string; onBack: () => void }): React.JSX.Element {
  const [run, setRun] = useState<PipoRun | null>(null);
  const [steps, setSteps] = useState<PipoRunStep[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [from, setFrom] = useState<{ name: string; startedAt: string } | null>(null);
  const team = usePipos((s) => s.list);
  useEffect(() => {
    void api.invoke('pipos:runDetail', runId).then(async (d) => {
      if (d) {
        setRun(d.run);
        setSteps(d.steps);
        // "Veio do Prospector, execução de ontem 9h."
        if (d.run.fromRunId) {
          const src = await api.invoke('pipos:runDetail', d.run.fromRunId);
          const owner = src ? team.find((p) => p.id === src.run.pipoId) : null;
          if (src && owner) setFrom({ name: owner.name, startedAt: src.run.startedAt });
        }
      }
    });
    return api.on('pipos:runUpdate', (u) => {
      if (u.run.id !== runId) return;
      setRun(u.run);
      setSteps(u.steps);
    });
  }, [runId]);
  if (!run) return <div className="h-full" />;
  const live = run.status === 'running' || run.status === 'waiting';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-[8px] pb-[8px]">
        <button type="button" onClick={onBack} className="flex items-center gap-[4px] text-[11.5px] text-fg-2 hover:text-fg">
          <IconChevron size={9} dir="left" /> {tt.back}
        </button>
        <span className="text-[12px] font-semibold text-fg">
          {tt.runTitle(run.id)} {run.dryRun && <span className="font-normal text-fg-3">· {tt.rehearsal}</span>}
        </span>
        <span className="text-[11px] text-fg-3">
          {fmtWhen(run.startedAt)} · {tt.trigger(run.trigger)}
          {from && ` · ${tt.cameFrom(from.name, fmtWhen(from.startedAt))}`}
        </span>
        <span className="flex-1" />
        {live && (
          <Button size="sm" onClick={() => void api.invoke('pipos:cancel', run.id)}>
            {tt.cancel}
          </Button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-[4px]">
        <ol className="relative ml-[9px] border-l pl-[16px]" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          {steps.map((s) => (
            <li key={s.id} className="relative pb-[10px]">
              <motion.span
                className="absolute -left-[25px] top-[1px] flex h-[17px] w-[17px] items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: '#0B0B0D', border: `1.5px solid ${s.status === 'running' ? color : STATUS_COLOR[s.status]}`, color: s.status === 'running' ? color : STATUS_COLOR[s.status] }}
                animate={s.status === 'running' ? { rotate: 360 } : { rotate: 0 }}
                transition={s.status === 'running' ? { duration: 1.4, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }}
              >
                {STATUS_ICON[s.status]}
              </motion.span>
              <button type="button" onClick={() => setOpen((v) => (v === s.key ? null : s.key))} className="flex w-full items-baseline gap-[8px] text-left">
                <span className={`text-[12.5px] ${s.status === 'pending' || s.status === 'skipped' ? 'text-fg-3' : 'text-fg'}`}>{s.title}</span>
                <span className="mono text-[10.5px] text-fg-3">{s.kind}</span>
                <span className="flex-1" />
                <span className="mono text-[10.5px] text-fg-3">{dur(s.startedAt, s.finishedAt)}</span>
              </button>
              {(s.error || s.preview) && (
                <div className={`mono mt-[2px] text-[11px] ${s.error ? 'text-[#FCA5A5]' : 'text-fg-2'} ${open === s.key ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>{s.error ?? s.preview}</div>
              )}
            </li>
          ))}
        </ol>
        {(run.summary || run.error) && !live && (
          <div className="mt-[4px] rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: run.status === 'done' ? `${color}1F` : 'rgba(239,68,68,0.08)' }}>
            {run.summary}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-[12px]">
      <div className="mb-[5px] flex items-center justify-between">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-fg-3">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Conversa com um Pipo colorido (mesmo chat, na cor dele). */
export async function openPipoChat(p: { id: number }): Promise<void> {
  const { conversationId } = await api.invoke('pipos:chat', p.id);
  useUi.getState().setTab('chat');
  await useChat.getState().openConversation(conversationId);
}

export function PipoDetail({ p, onBack }: { p: PipoSummary; onBack: () => void }): React.JSX.Element {
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openRunId = usePipos((s) => s.openRunId);
  const team = usePipos((s) => s.list);
  const color = PIPO_COLORS[p.color];
  const reload = async (): Promise<void> => {
    const r = await api.invoke('pipos:get', p.id);
    if (r) setD({ versions: r.versions, triggers: r.triggers, runs: r.runs, memory: r.memory, secrets: r.secrets });
  };
  useEffect(() => {
    void reload();
    const off = api.on('pipos:runUpdate', (u) => {
      if (u.run.pipoId === p.id) void reload();
    });
    return off;
  }, [p.id]);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(id);
  }, [msg]);

  if (openRunId) return <RunTimeline runId={openRunId} color={color} onBack={() => usePipos.getState().open(p.id, null)} />;

  const version = d?.versions.find((v) => v.version === p.activeVersion) ?? null;
  const steps = version ? describePlaybook(version.playbook) : [];
  const working = p.live.state === 'working' || p.live.state === 'waiting';
  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-[12px] pb-[10px]">
        <button type="button" onClick={onBack} aria-label={tt.back} className="text-fg-2 hover:text-fg">
          <IconChevron size={10} dir="left" />
        </button>
        <Mascot state={working ? 'working' : p.paused ? 'sleepy' : 'idle'} size={44} color={color} accessories={pipoAccessoryLayers(p.accessory)} glow={working} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[8px]">
            <span className="text-[15px] font-semibold text-fg">{p.name}</span>
            <span className="mono text-[11px] text-fg-3">@{p.slug}</span>
            {version && <span className="mono text-[10.5px] text-fg-3">v{version.version}</span>}
            {p.paused && <span className="rounded-full px-[6px] text-[10.5px] text-fg-2" style={{ background: 'rgba(255,255,255,0.08)' }}>{tt.paused}</span>}
          </div>
          <p className="truncate text-[12px] text-fg-2">{p.live.stepLabel ?? p.personality.mission}</p>
        </div>
        <span className="text-[11.5px] text-fg-2">{msg}</span>
      </div>

      <div className="flex flex-wrap items-center gap-[6px] pb-[10px]">
        {working ? (
          <Button size="sm" onClick={() => p.live.runId && void api.invoke('pipos:cancel', p.live.runId)}>
            {tt.cancel}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!p.activeVersion} onClick={() => void act(() => api.invoke('pipos:run', p.id, { trigger: 'manual' }), tt.running(p.name))}>
            <IconPlay size={8} /> {tt.run}
          </Button>
        )}
        <Button size="sm" disabled={!p.activeVersion || working} onClick={() => void act(() => api.invoke('pipos:run', p.id, { trigger: 'ensaio', dryRun: true }), tt.rehearsing)}>
          {tt.rehearse}
        </Button>
        <Button size="sm" onClick={() => void act(() => api.invoke('pipos:update', p.id, { paused: !p.paused }))}>{p.paused ? tt.resume : tt.pause}</Button>
        <Button size="sm" onClick={() => void openPipoChat(p)}>{tt.talk}</Button>
        <Button
          size="sm"
          onClick={() => {
            useUi.getState().setTab('chat');
            void useChat.getState().send(`/editarpipo ${p.slug}`);
          }}
        >
          {tt.edit}
        </Button>
        <Button size="sm" variant="tertiary" disabled={!p.activeVersion} onClick={() => void act(() => api.invoke('pipos:saveModel', p.id), tt.savedModel)}>
          {tt.saveModel}
        </Button>
        <span className="flex-1" />
        {confirmDelete ? (
          <>
            <span className="text-[11.5px] text-fg-2">{tt.deleteConfirm}</span>
            <Button size="sm" variant="tertiary" onClick={() => setConfirmDelete(false)}>
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={() => void act(async () => { await api.invoke('pipos:delete', p.id); onBack(); })}>
              {tt.delete}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="tertiary" onClick={() => setConfirmDelete(true)}>
            {tt.delete}
          </Button>
        )}
      </div>

      <div className="scroll-thin grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-[14px] overflow-y-auto overflow-x-hidden pr-[4px]">
        <div>
          <Section title={version ? tt.planV(version.version) : tt.plan}>
            {steps.length === 0 && <p className="text-[12px] text-fg-3">{tt.noPlan}</p>}
            <div className="flex flex-col gap-[3px]">
              {steps.map((s) => (
                <div key={s.title} className="rounded-[8px] px-[9px] py-[4px]" style={{ background: 'var(--bg-card-hover)' }}>
                  <div className="truncate text-[12px] text-fg">{s.title}</div>
                  <div className="mono truncate text-[10.5px] text-fg-3">{s.detail}</div>
                </div>
              ))}
            </div>
          </Section>
          <Section title={tt.whenRuns}>
            <p className="text-[12px] text-fg-2">
              {d?.triggers.filter((x) => x.kind === 'schedule').map((x) => ('text' in x.spec ? x.spec.text : '')).join(' · ') || tt.onlyManual}
            </p>
            {p.nextRunAt && <p className="text-[11.5px] text-fg-3">{tt.nextRun(fmtWhen(p.nextRunAt))}</p>}
            {d?.triggers
              .filter((x) => x.kind === 'after_pipo')
              .map((x) => {
                const spec = x.spec as { from?: string };
                const src = spec.from ? team.find((t2) => t2.slug === spec.from) : null;
                return (
                  <p key={x.id} className="flex items-center gap-[6px] text-[11.5px] text-fg-3">
                    {'from' in x.spec ? tt.afterPipo(x.spec.from, x.spec.delayMin) : ''}
                    {src && (
                      <button type="button" className="text-fg-3 underline-offset-2 hover:text-fg hover:underline" onClick={() => void api.invoke('pipos:unlink', src.id, p.id).then(reload)}>
                        {tt.unlink}
                      </button>
                    )}
                  </p>
                );
              })}
          </Section>
          <AccessoryPicker p={p} />
        </div>
        <div>
          <Section title={tt.runs}>
            {(d?.runs.length ?? 0) === 0 && <p className="text-[12px] text-fg-3">{tt.noRuns}</p>}
            <div className="flex flex-col gap-[2px]">
              {d?.runs.slice(0, 12).map((r) => (
                <button key={r.id} type="button" onClick={() => usePipos.getState().open(p.id, r.id)} className="flex items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] text-left hover:bg-white/[0.05]">
                  <span className="text-[11px]" style={{ color: r.status === 'done' ? '#22C55E' : r.status === 'failed' ? '#EF4444' : r.status === 'running' || r.status === 'waiting' ? color : '#A1A1AA' }}>
                    {r.status === 'done' ? '✓' : r.status === 'failed' ? '✕' : r.status === 'running' || r.status === 'waiting' ? '⟳' : '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{r.dryRun ? `${tt.rehearsal} · ` : ''}{r.summary?.replace(`${p.name}: `, '') ?? tt.inProgress}</span>
                  <span className="shrink-0 text-[10.5px] text-fg-3">{fmtWhen(r.startedAt)}</span>
                </button>
              ))}
            </div>
          </Section>
          <Section title={tt.memory}>
            {(d?.memory.length ?? 0) === 0 ? (
              <p className="text-[12px] text-fg-3">{tt.noMemory}</p>
            ) : (
              d?.memory.map((m) => (
                <div key={m.id} className="group flex items-center gap-[6px] text-[12px] text-fg">
                  <span className="text-fg-3">•</span>
                  <span className="min-w-0 flex-1 truncate">{m.rule}</span>
                  <button type="button" aria-label={t.common.remove} className="opacity-0 group-hover:opacity-100" onClick={() => void api.invoke('pipos:deleteMemory', m.id).then(reload)}>
                    <IconX size={9} />
                  </button>
                </div>
              ))
            )}
          </Section>
          <Section title={tt.secrets}>
            <p className="mono text-[11.5px] text-fg-2">{d?.secrets.length ? d.secrets.join(', ') : '—'}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function AccessoryPicker({ p }: { p: PipoSummary }): React.JSX.Element {
  const color = PIPO_COLORS[p.color];
  return (
    <Section title={tt.look}>
      <div className="flex flex-wrap gap-[4px]">
        {(Object.keys(PIPO_COLORS) as PipoColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => void api.invoke('pipos:update', p.id, { color: c })}
            className="h-[16px] w-[16px] rounded-[5px]"
            style={{ background: PIPO_COLORS[c], outline: c === p.color ? '2px solid #fff' : 'none', outlineOffset: 1 }}
          />
        ))}
      </div>
      <div className="mt-[6px] flex flex-wrap gap-[4px]">
        <AnimatePresence initial={false}>
          {(Object.keys(PIPO_ACCESSORY_NAMES) as PipoAccessory[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => void api.invoke('pipos:update', p.id, { accessory: a })}
              className="flex flex-col items-center rounded-[8px] px-[4px] pt-[2px] text-[10px] text-fg-2"
              style={{ background: a === p.accessory ? `${color}2A` : 'transparent', outline: a === p.accessory ? `1px solid ${color}` : 'none' }}
            >
              <Mascot state="idle" size={20} color={color} accessories={pipoAccessoryLayers(a)} glow={false} still />
              {PIPO_ACCESSORY_NAMES[a]}
            </button>
          ))}
        </AnimatePresence>
      </div>
    </Section>
  );
}
