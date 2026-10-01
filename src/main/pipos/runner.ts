// Executor do plano de execução (Fase 17). Determinístico onde dá; o agente só nos passos `agent`.
// Modo seco, máscara de segredos, cancelamento, limite de tempo, confirmação de ações externas,
// métricas declaradas, pausa após 3 falhas e no máximo 2 execuções ao mesmo tempo (1 por Pipo).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentStep, Pipo, PipoPlaybook, PipoRun, PipoStep } from '@shared/pipos';
import { evaluate, render, renderText, type TemplateCtx } from '@shared/template';
import type { AgentEffort, AgentModel } from '@shared/types';
import { setLive } from './live';
import { consecutiveFailures, createRun, ensurePipoDirs, finishRun, getPermission, listMemory, setPermission, setStep, updatePipo } from './repo';
import { maskSecrets, pipoSecrets } from './secrets';
import { runHttp, runMcp, runScript, runSheet, StepError, type StepEnv } from './steps';

export type ConfirmAnswer = 'yes' | 'no' | 'always' | 'timeout';
/** Aprovação em lote: os itens que ficaram (com as edições do usuário). */
export interface ConfirmResult {
  answer: ConfirmAnswer;
  items?: unknown[];
}

export interface RunnerDeps {
  agent: (o: { system: string; prompt: string; model: AgentModel; effort: AgentEffort; readDirs: string[]; signal: AbortSignal }) => Promise<string>;
  confirm: (o: { pipo: Pipo; runId: number; stepKey: string; title: string; message: string; preview: string | null; list: unknown[] | null }) => Promise<ConfirmAnswer | ConfirmResult>;
  notify: (o: { pipo: Pipo; title: string; body: string | null; final: boolean; run: PipoRun | null; trigger: string }) => void | Promise<void>;
  gfetch: <T>(url: string, init?: RequestInit) => Promise<T>;
  fetch: typeof fetch;
  handoff: (o: { from: Pipo; to: string; payload: unknown; run: boolean; runId: number }) => Promise<string>;
  askPipo: (o: { from: Pipo; slug: string; question: string; signal: AbortSignal }) => Promise<string>;
  update: (runId: number) => void;
}

export interface RunRequest {
  pipo: Pipo;
  playbook: PipoPlaybook;
  version: number;
  dryRun: boolean;
  trigger: string;
  input?: unknown;
  fromRunId?: number | null;
}

const short = (v: unknown, max = 220): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Prompt de sistema de um passo `agent`: a personalidade do Pipo e as regras que ele aprendeu. */
export function pipoSystemPrompt(pipo: Pipo, rules: string[], json: boolean): string {
  const p = pipo.personality;
  return [
    `Você é o Pipo ${pipo.name}, um agente da equipe de Pipos do usuário, rodando um passo de um plano de execução fixo.`,
    p.mission && `Missão: ${p.mission}`,
    p.tone && `Tom: ${p.tone}`,
    p.never.length ? `Você nunca: ${p.never.join('; ')}.` : null,
    rules.length ? `Regras que o usuário te ensinou (sempre siga):\n${rules.map((r) => `- ${r}`).join('\n')}` : null,
    'Faça só o que o passo pede. Não invente dados. Escreva em português do Brasil.',
    json ? 'Responda APENAS com JSON válido, sem markdown e sem texto antes ou depois.' : 'Responda só com o resultado, sem narrar o que vai fazer.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseAgentJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = /[[{][\s\S]*[\]}]/.exec(t);
    if (m) return JSON.parse(m[0]);
    throw new StepError('O agente não devolveu JSON válido.');
  }
}

export function summarize(pipo: Pipo, playbook: PipoPlaybook, metrics: Record<string, number>, minutes: number): string {
  const parts = playbook.metrics.filter((m) => metrics[m.key] !== undefined).map((m) => `${metrics[m.key]} ${m.label}`);
  return parts.length ? `${pipo.name}: ${parts.join(', ')}.` : `${pipo.name}: concluído em ${minutes < 1 ? 'menos de 1 min' : `${Math.round(minutes)} min`}.`;
}

interface Active {
  runId: number;
  pipoId: number;
  ac: AbortController;
}

const active = new Map<number, Active>();
const finished = new Map<number, { promise: Promise<PipoRun>; resolve: (r: PipoRun) => void }>();

/** Espera uma execução terminar (ensaio do /criarpipo, testes). */
export function runDone(runId: number): Promise<PipoRun> {
  let entry = finished.get(runId);
  if (!entry) {
    let resolve: (r: PipoRun) => void = () => undefined;
    const promise = new Promise<PipoRun>((r) => (resolve = r));
    entry = { promise, resolve };
    finished.set(runId, entry);
  }
  return entry.promise;
}
const queue: Array<{ req: RunRequest; start: (runId: number | null) => void }> = [];
export const MAX_PARALLEL = 2;

/** Ganchos de quem precisa saber que uma execução terminou (conexão entre Pipos). */
export const runnerHooks: { finished: Array<(run: PipoRun) => void> } = { finished: [] };

export function activeRuns(): Array<{ runId: number; pipoId: number }> {
  return [...active.values()].map((a) => ({ runId: a.runId, pipoId: a.pipoId }));
}

export function isRunning(pipoId: number): boolean {
  return [...active.values()].some((a) => a.pipoId === pipoId);
}

export function cancelRun(runId: number): boolean {
  const a = active.get(runId);
  if (!a) return false;
  a.ac.abort();
  return true;
}

/**
 * Pede uma execução. Começa na hora se houver vaga (máx. 2, uma por Pipo) ou espera na fila.
 * Resolve com o id da execução quando ela começa (null se foi descartada).
 */
export function requestRun(req: RunRequest, deps: RunnerDeps): Promise<number | null> {
  return new Promise((resolve) => {
    queue.push({ req, start: resolve });
    pump(deps);
  });
}

function pump(deps: RunnerDeps): void {
  for (let i = 0; i < queue.length && active.size < MAX_PARALLEL; i++) {
    const item = queue[i];
    if (isRunning(item.req.pipo.id)) continue;
    queue.splice(i, 1);
    i--;
    void execute(item.req, deps, (runId) => item.start(runId)).finally(() => pump(deps));
  }
  for (const q of queue) setLive(q.req.pipo.id, 'working', null, 'na fila');
}

/** Roda o plano inteiro. Exportado para testes (sem fila). */
export async function execute(req: RunRequest, deps: RunnerDeps, onStart: (runId: number) => void = () => undefined): Promise<PipoRun> {
  const { pipo, playbook, dryRun } = req;
  const pipoDir = ensurePipoDirs(pipo.slug);
  const run = createRun(pipo.id, req.version, req.trigger, dryRun, req.fromRunId ?? null, playbook.steps);
  const ac = new AbortController();
  active.set(run.id, { runId: run.id, pipoId: pipo.id, ac });
  onStart(run.id);
  const runDir = join(pipoDir, 'runs', String(run.id));
  mkdirSync(runDir, { recursive: true });
  const secrets = pipoSecrets(pipo.slug);
  const mask = (s: string): string => maskSecrets(s, secrets);
  const now = new Date();
  const ctx: TemplateCtx & { passos: Record<string, { saida: unknown }> } = {
    entrada: req.input ?? null,
    passos: {},
    pipo: { nome: pipo.name, slug: pipo.slug },
    execucao: { id: run.id, seco: dryRun },
    agora: { iso: now.toISOString(), data: now.toLocaleDateString('pt-BR'), hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
    segredo: secrets,
  };
  const env: StepEnv = { pipoDir, runDir, ctx, secrets, dryRun, signal: ac.signal, input: req.input ?? null };
  const rules = listMemory(pipo.id).map((m) => m.rule);
  const timeout = setTimeout(() => ac.abort(), Math.max(1, playbook.limits.maxRunMinutes) * 60_000);
  const startedAt = Date.now();
  let approvedInRun = false;
  let status: PipoRun['status'] = 'done';
  let error: string | null = null;
  const steps = playbook.steps;
  const total = steps.length;
  setLive(pipo.id, 'working', run.id, dryRun ? 'ensaio' : null);
  deps.update(run.id);

  const gate = async (step: PipoStep): Promise<boolean> => {
    // Ação com efeito fora da máquina: precisa de um "confirmar" antes, ou de "sempre permitir".
    if (dryRun || !step.external || approvedInRun || step.kind === 'confirm') return true;
    if (getPermission(pipo.id, step.key).alwaysAllow) return true;
    setLive(pipo.id, 'waiting', run.id, step.title);
    setStep(run.id, step.key, { status: 'waiting' });
    deps.update(run.id);
    const r = await deps.confirm({ pipo, runId: run.id, stepKey: step.key, title: step.title, message: `Vou ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}. Pode?`, preview: null, list: null });
    const a = typeof r === 'string' ? r : r.answer;
    if (a === 'always') setPermission(pipo.id, step.key, true, null);
    setLive(pipo.id, 'working', run.id, step.title);
    return a === 'yes' || a === 'always';
  };

  const runStep = async (step: PipoStep): Promise<{ output: unknown; jump?: string | 'end' }> => {
    switch (step.kind) {
      case 'script':
        return { output: await runScript(step, env) };
      case 'http':
        return { output: await runHttp(step, env, deps.fetch) };
      case 'mcp':
        return { output: await runMcp(step, env) };
      case 'sheet':
        return { output: await runSheet(step, env, deps.gfetch) };
      case 'agent':
        return { output: await runAgent(step) };
      case 'confirm': {
        const message = renderText(step.message, ctx);
        const preview = step.preview ? renderText(step.preview, ctx) : null;
        const listRaw = step.list ? render(step.list, ctx) : null;
        const list = Array.isArray(listRaw) ? listRaw : null;
        if (dryRun) return { output: { seco: true, pediria: message, previa: preview, itens: list?.length ?? null } };
        const perm = getPermission(pipo.id, step.key);
        if (perm.alwaysAllow && (perm.limitN === null || (list?.length ?? 0) <= perm.limitN)) {
          approvedInRun = true;
          return { output: { aprovado: true, automatico: true } };
        }
        setLive(pipo.id, 'waiting', run.id, step.title);
        setStep(run.id, step.key, { status: 'waiting' });
        deps.update(run.id);
        const r = await deps.confirm({ pipo, runId: run.id, stepKey: step.key, title: step.title, message, preview, list });
        const a = typeof r === 'string' ? r : r.answer;
        setLive(pipo.id, 'working', run.id, step.title);
        if (a === 'always') setPermission(pipo.id, step.key, true, list ? Math.max(list.length, 1) : null);
        if (a !== 'yes' && a !== 'always') throw new CancelRun(a === 'timeout' ? 'Ninguém respondeu a confirmação.' : 'Você recusou a confirmação.');
        approvedInRun = true;
        // Lote: os próximos passos usam {{passos.<chave>.saida.itens}} (só os aprovados, já editados).
        const items = typeof r === 'string' ? list : (r.items ?? list);
        if (list && items && !items.length) throw new CancelRun('Você pulou todos os itens.');
        return { output: list ? { aprovado: true, itens: items, pulados: list.length - (items?.length ?? 0) } : { aprovado: true } };
      }
      case 'branch':
        if (evaluate(step.if, ctx)) return { output: { condicao: true }, jump: step.then === 'end' ? 'end' : step.then.replace(/^goto:/, '') };
        return { output: { condicao: false } };
      case 'notify': {
        const title = renderText(step.title, ctx);
        const body = step.body ? renderText(step.body, ctx) : null;
        if (!dryRun) await deps.notify({ pipo, title, body, final: false, run: null, trigger: req.trigger });
        return { output: { aviso: title, texto: body, seco: dryRun || undefined } };
      }
      case 'handoff': {
        const payload = render(step.payload, ctx);
        if (dryRun) return { output: { seco: true, entregaria_para: step.to, itens: Array.isArray(payload) ? payload.length : null } };
        return { output: { entregue: await deps.handoff({ from: pipo, to: step.to, payload, run: step.run, runId: run.id }) } };
      }
    }
  };

  const runAgent = async (step: AgentStep): Promise<unknown> => {
    let prompt = renderText(step.prompt, ctx);
    if (step.askPipo) {
      const answer = await deps.askPipo({ from: pipo, slug: step.askPipo, question: prompt, signal: ac.signal });
      prompt += `\n\nO Pipo @${step.askPipo} respondeu:\n${answer}`;
    }
    const text = await deps.agent({
      system: pipoSystemPrompt(pipo, rules, !!step.json),
      prompt: `${prompt}\n\n(Saídas completas dos passos anteriores, se precisar: ${runDir})`,
      model: step.model ?? pipo.model,
      effort: step.effort ?? pipo.effort,
      readDirs: [runDir],
      signal: ac.signal,
    });
    return step.json ? parseAgentJson(text) : text.trim();
  };

  try {
    let i = 0;
    let guard = 0;
    while (i < total) {
      if (++guard > 200) throw new StepError('O plano entrou em repetição (mais de 200 passos).');
      if (ac.signal.aborted) throw new CancelRun('Cancelado.');
      const step = steps[i];
      setStep(run.id, step.key, { status: 'running' });
      setLive(pipo.id, 'working', run.id, `${step.title} (${i + 1}/${total})`);
      deps.update(run.id);
      try {
        if (!(await gate(step))) throw new CancelRun('Você recusou a ação.');
        const { output, jump } = await runStep(step);
        ctx.passos[step.key] = { saida: output };
        const json = mask(JSON.stringify(output ?? null, null, 2));
        writeFileSync(join(runDir, `${step.key}.json`), json);
        setStep(run.id, step.key, { status: 'done', preview: mask(short(output)) });
        deps.update(run.id);
        if (jump === 'end') {
          for (const s of steps.slice(i + 1)) setStep(run.id, s.key, { status: 'skipped' });
          break;
        }
        if (jump) {
          const j = steps.findIndex((s) => s.key === jump);
          if (j < 0) throw new StepError(`Passo "${jump}" não existe.`);
          for (const s of steps.slice(i + 1, j)) setStep(run.id, s.key, { status: 'skipped' });
          i = j;
          continue;
        }
      } catch (x) {
        const msg = mask(x instanceof Error ? x.message : String(x));
        if (x instanceof CancelRun || ac.signal.aborted) {
          setStep(run.id, step.key, { status: 'skipped', error: msg });
          throw x instanceof CancelRun ? x : new CancelRun(Date.now() - startedAt >= playbook.limits.maxRunMinutes * 60_000 ? 'Passou do tempo máximo da execução.' : 'Cancelado.');
        }
        setStep(run.id, step.key, { status: 'failed', error: msg });
        deps.update(run.id);
        if (step.onError !== 'continue') throw new StepError(`${step.title}: ${msg}`);
        ctx.passos[step.key] = { saida: { erro: msg } };
      }
      i++;
    }
  } catch (x) {
    status = x instanceof CancelRun ? 'cancelled' : 'failed';
    error = mask(x instanceof Error ? x.message : String(x));
  } finally {
    clearTimeout(timeout);
    active.delete(run.id);
  }

  // Métricas declaradas no plano.
  const metrics: Record<string, number> = {};
  for (const m of playbook.metrics) {
    try {
      const v = Number(render(m.from, ctx));
      if (Number.isFinite(v)) metrics[m.key] = v;
    } catch {
      // métrica que não resolveu fica de fora
    }
  }
  const minutes = (Date.now() - startedAt) / 60_000;
  const summary = status === 'done' ? summarize(pipo, playbook, metrics, minutes) : `${pipo.name}: ${status === 'cancelled' ? 'cancelado' : 'falhou'} — ${error}`;
  const finished_ = finishRun(run.id, status, { summary, metrics, error });
  setLive(pipo.id, status === 'done' ? 'done' : status === 'failed' ? 'error' : 'idle', run.id, null);
  deps.update(run.id);
  void runDone(run.id);
  for (const h of runnerHooks.finished) {
    try {
      h(finished_);
    } catch (e) {
      console.warn('[pipos] gancho de fim falhou:', e);
    }
  }
  finished.get(run.id)?.resolve(finished_);
  setTimeout(() => finished.delete(run.id), 60_000).unref?.();

  if (!dryRun) {
    await deps.notify({ pipo, title: summary, body: null, final: true, run: finished_, trigger: req.trigger });
    // 3 falhas seguidas pausam o Pipo.
    if (status === 'failed' && consecutiveFailures(pipo.id) >= 3) {
      updatePipo(pipo.id, { paused: true });
      await deps.notify({ pipo, title: `${pipo.name} pausou depois de 3 falhas seguidas.`, body: error, final: false, run: finished_, trigger: 'pause' });
    }
  }
  return finished_;
}

class CancelRun extends Error {}
