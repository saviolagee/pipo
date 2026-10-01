// Dependências reais do executor: agente, confirmações no notch, avisos, Google, conexão entre Pipos.
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIPO_COLORS, type Pipo, type PipoRun } from '@shared/pipos';
import { runRaw } from '../agent/service';
import { emit } from '../bus';
import { showCard } from '../cards';
import { db } from '../db';
import { focusState } from '../focus/session';
import { googleFetch } from '../integrations/google-auth';
import { interruptions } from '../interruptions/manager';
import { activePlaybook, ensurePipoDirs, getPipo, getRun, listMemory, runSteps } from './repo';
import { pipoSystemPrompt, requestRun, type ConfirmAnswer, type RunnerDeps } from './runner';

/** Execuções que o próprio usuário pediu (o relatório final aparece na hora). */
const USER_TRIGGERS = /^(manual|chat|rehearsal|ensaio)/;

/** Relatórios de execuções agendadas esperam o foco acabar (Fase 19). */
const heldReports: Array<() => Promise<void>> = [];

export function flushHeldReports(): void {
  if (focusState()) return;
  const items = heldReports.splice(0);
  for (const r of items) void r();
}

async function confirm(o: Parameters<RunnerDeps['confirm']>[0]): Promise<ConfirmAnswer> {
  const listItems = o.list?.slice(0, 50).map((x) => {
    if (x && typeof x === 'object') {
      const r = x as Record<string, unknown>;
      const title = String(r.titulo ?? r.title ?? r.assunto ?? r.subject ?? r.email ?? r.nome ?? r.name ?? JSON.stringify(x)).slice(0, 120);
      const detail = String(r.texto ?? r.body ?? r.corpo ?? r.mensagem ?? '').slice(0, 600);
      return { title, detail: detail || undefined };
    }
    return { title: String(x).slice(0, 120) };
  });
  const answer = await showCard(
    {
      kind: 'action',
      glow: 'attention',
      mascot: 'attention',
      pipoColor: PIPO_COLORS[o.pipo.color],
      label: `${o.pipo.name} · ${o.title}`,
      subject: o.message,
      body: o.preview ? o.preview.slice(0, 500) : undefined,
      list: listItems,
      buttons: [
        { id: 'no', label: 'Recusar', kbd: 'N', variant: 'secondary' },
        { id: 'always', label: o.list ? `Sempre permitir (até ${o.list.length})` : 'Sempre permitir', variant: 'tertiary' },
        { id: 'yes', label: 'Confirmar', kbd: 'Y', variant: 'primary' },
      ],
    },
    { timeoutMs: 30 * 60_000 },
  );
  if (answer === 'yes' || answer === 'always' || answer === 'no') return answer;
  return answer === 'timeout' ? 'timeout' : 'no';
}

async function notify(o: Parameters<RunnerDeps['notify']>[0]): Promise<void> {
  const card = {
    kind: 'info' as const,
    glow: (o.run?.status === 'failed' ? 'attention' : 'done') as 'attention' | 'done',
    mascot: (o.run?.status === 'failed' ? 'sad' : 'happy') as 'sad' | 'happy',
    pipoColor: PIPO_COLORS[o.pipo.color],
    label: o.pipo.name,
    title: o.title,
    body: o.body ?? undefined,
    buttons: [
      ...(o.run ? [{ id: 'open', label: 'Ver execução', variant: 'secondary' as const }] : []),
      { id: 'ok', label: 'OK', kbd: 'Y' as const, variant: 'primary' as const },
    ],
    autoDismissMs: 10_000,
  };
  const handle = (answer: string | null): void => {
    if (answer === 'open' && o.run) emit('ui:openPipoRun', { pipoId: o.pipo.id, runId: o.run.id });
  };
  if (USER_TRIGGERS.test(o.trigger)) {
    handle(await showCard(card));
    return;
  }
  // Agendada/evento: não interrompe o foco, e o card entra no orçamento de interrupções.
  const send = async (): Promise<void> => handle(await interruptions.request({ type: 'pipo', card, fallbackExpression: 'happy', queueable: true }));
  if (focusState()) heldReports.push(send);
  else await send();
}

async function handoff(o: Parameters<RunnerDeps['handoff']>[0]): Promise<string> {
  const target = getPipo(o.to);
  if (!target) throw new Error(`Não existe Pipo @${o.to}.`);
  if (target.id === o.from.id) throw new Error('Um Pipo não pode entregar para ele mesmo.');
  const dir = ensurePipoDirs(target.slug);
  const file = join(dir, 'inbox', `${Date.now()}-${o.from.slug}.json`);
  writeFileSync(file, JSON.stringify(o.payload ?? null, null, 2));
  const link = db().get<{ delay_min: number }>("SELECT delay_min FROM pipo_links WHERE from_pipo_id = ? AND to_pipo_id = ? AND enabled = 1 ORDER BY delay_min LIMIT 1", o.from.id, target.id);
  const delayMin = link?.delay_min ?? 0;
  const runAfter = new Date(Date.now() + delayMin * 60_000).toISOString();
  db().run('INSERT INTO pipo_inbox (to_pipo_id, from_run_id, payload_path, status, run_after, created_at) VALUES (?, ?, ?, ?, ?, ?)', target.id, o.runId, file, o.run ? 'pending' : 'stored', o.run ? runAfter : null, new Date().toISOString());
  emit('pipos:handoff', { fromPipoId: o.from.id, toPipoId: target.id });
  inboxHooks.changed();
  return o.run ? (delayMin ? `para @${target.slug}, roda em ${delayMin} min` : `para @${target.slug}, rodando agora`) : `guardado na caixa de entrada de @${target.slug}`;
}

/** Preenchido pela Fase 21 (atrasos, ciclos); por padrão processa a caixa de entrada já. */
export const inboxHooks: { changed: () => void } = { changed: () => undefined };

async function askPipo(o: Parameters<RunnerDeps['askPipo']>[0]): Promise<string> {
  const target = getPipo(o.slug);
  if (!target) throw new Error(`Não existe Pipo @${o.slug}.`);
  // Profundidade 1: o Pipo consultado responde só com a personalidade dele, sem chamar outros.
  return runRaw({
    system: pipoSystemPrompt(target, listMemory(target.id).map((m) => m.rule), false),
    prompt: `O Pipo ${o.from.name} pediu sua ajuda:\n\n${o.question}`,
    model: target.model,
    effort: target.effort,
    readDirs: [],
    signal: o.signal,
  });
}

export const realDeps: RunnerDeps = {
  agent: (o) => runRaw(o),
  confirm,
  notify,
  gfetch: googleFetch,
  fetch: (...a) => fetch(...a),
  handoff,
  askPipo,
  update: (runId) => {
    const run = getRun(runId);
    if (run) emit('pipos:runUpdate', { run, steps: runSteps(runId) });
  },
};

/** Dispara uma execução do plano ativo (ou de um plano em rascunho, no ensaio). */
export function startRun(pipoId: number, opts: { dryRun?: boolean; trigger: string; input?: unknown; fromRunId?: number | null; playbook?: import('@shared/pipos').PipoPlaybook }): Promise<number | null> {
  const pipo = getPipo(pipoId) as Pipo;
  if (!pipo) throw new Error('Pipo não encontrado.');
  const active = activePlaybook(pipoId);
  const playbook = opts.playbook ?? active?.playbook;
  if (!playbook || !playbook.steps.length) throw new Error(`${pipo.name} ainda não tem um plano de execução.`);
  return requestRun({ pipo, playbook, version: opts.playbook ? 0 : (active?.version ?? 0), dryRun: !!opts.dryRun, trigger: opts.trigger, input: opts.input, fromRunId: opts.fromRunId ?? null }, realDeps);
}

/** Copia um script do usuário para scripts/ do Pipo (arrastar arquivo na criação). */
export function importScript(pipoId: number, sourcePath: string, name?: string): string {
  const p = getPipo(pipoId);
  if (!p) throw new Error('Pipo não encontrado.');
  const dir = ensurePipoDirs(p.slug);
  const fileName = (name ?? sourcePath.split(/[\\/]/).pop() ?? 'script').replace(/[^\w.-]/g, '_');
  copyFileSync(sourcePath, join(dir, 'scripts', fileName));
  return `scripts/${fileName}`;
}

export type { PipoRun };
