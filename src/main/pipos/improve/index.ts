// Pipo que se aprimora (método adaptado do Harness², Google Research, Apache 2.0). Depois de uma
// execução real, e só com motivo: estuda a execução, propõe duas versões (geral e do assunto), ensaia as
// duas em modo seco, junta o que teve evidência, ensaia a junção e sugere ao usuário. Nada muda sem ele
// aprovar. As lições comprovadas vão para uma biblioteca que todos os Pipos e o construtor usam.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCandidate, parseComposition, shouldImprove, type Candidate, type Composition, type PipoImprovement } from '@shared/improve';
import { normalizePlaybook, validatePlaybook } from '@shared/plan-check';
import { PIPO_COLORS, type Pipo, type PipoPlaybook } from '@shared/pipos';
import { agentAvailable, runRaw } from '../../agent/service';
import { emit } from '../../bus';
import { getKV, setKV } from '../../db/repos/settings';
import { handle } from '../../ipc';
import { interruptions } from '../../interruptions/manager';
import { startRun } from '../deps';
import { pipesChanged } from '../ipc';
import { readMcpConfig } from '../mcp-client';
import { activePlaybook, addMemory, addVersion, getPipo, getRun, lastRun, listPipos, pipoDir, runSteps } from '../repo';
import { runDone, runnerHooks } from '../runner';
import { secretNames } from '../secrets';
import { improveSignals, pipoText, rehearsalText, runInput, runText, type Rehearsal } from './evidence';
import { composerSystem, proposerSystem } from './prompts';
import { addLesson, closeOrphanImprovements, createImprovement, decideImprovementRow, finishImprovement, getImprovement, improvementPlaybook, listImprovements } from './store';

export interface ImproveDeps {
  /** Pergunta ao modelo (Opus) e devolve o texto. */
  ask: (system: string, prompt: string) => Promise<string>;
  /** Ensaia uma versão em modo seco com a entrada dada. */
  rehearse: (pipo: Pipo, playbook: PipoPlaybook, input: unknown) => Promise<Rehearsal>;
}

let busy = false;
const autoKey = (pipoId: number): string => `pipo:improve:auto:${pipoId}`;
export const autoImproveOn = (pipoId: number): boolean => getKV<boolean>(autoKey(pipoId), true);

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function envOf(pipo: Pipo): Parameters<typeof validatePlaybook>[1] {
  const dir = pipoDir(pipo.slug);
  const scripts = existsSync(join(dir, 'scripts')) ? readdirSync(join(dir, 'scripts')) : [];
  return { secrets: secretNames(pipo.slug), scripts, pipos: listPipos().map((x) => x.slug), mcpServers: Object.keys(readMcpConfig(dir)) };
}

/** O que uma candidata não pode ter: erro de plano, ou risco/dependência nova que o plano atual não tinha. */
export function candidateProblem(plan: PipoPlaybook, base: PipoPlaybook, env: Parameters<typeof validatePlaybook>[1]): string | null {
  const issues = validatePlaybook(normalizePlaybook(plan), env);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) return errors.map((i) => `${i.step ? `${i.step}: ` : ''}${i.message}`).join(' ');
  const before = new Set(validatePlaybook(normalizePlaybook(base), env).map((i) => `${i.step}|${i.message}`));
  const added = issues.filter((i) => !before.has(`${i.step}|${i.message}`));
  // Ação externa sem confirmação, script, segredo ou servidor que não existem: não vale numa melhoria.
  return added.length ? added.map((i) => `${i.step ? `${i.step}: ` : ''}${i.message}`).join(' ') : null;
}

async function propose(dim: 'geral' | 'assunto', context: string, deps: ImproveDeps, base: PipoPlaybook, env: Parameters<typeof validatePlaybook>[1]): Promise<Candidate | null> {
  let prompt = context;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = parseCandidate(await deps.ask(proposerSystem(dim), prompt));
      if (c.manter || !c.plano) return c;
      const problem = candidateProblem(c.plano, base, env);
      if (!problem) return { ...c, plano: normalizePlaybook(c.plano) };
      prompt = `${context}\n\nSua resposta anterior foi recusada: ${problem} Corrija e responda de novo.`;
    } catch (e) {
      prompt = `${context}\n\nSua resposta anterior foi recusada: ${msg(e)} Responda só com o JSON pedido.`;
    }
  }
  return null;
}

async function compose(context: string, deps: ImproveDeps, base: PipoPlaybook, env: Parameters<typeof validatePlaybook>[1]): Promise<Composition | null> {
  let prompt = context;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = parseComposition(await deps.ask(composerSystem(), prompt));
      if (c.decisao === 'manter' || !c.plano) return c;
      const problem = candidateProblem(c.plano, base, env);
      if (!problem) return { ...c, plano: normalizePlaybook(c.plano) };
      prompt = `${context}\n\nSua resposta anterior foi recusada: ${problem} Corrija e responda de novo.`;
    } catch (e) {
      prompt = `${context}\n\nSua resposta anterior foi recusada: ${msg(e)} Responda só com o JSON pedido.`;
    }
  }
  return null;
}

function changed(pipoId: number): void {
  emit('pipos:improvement', { pipoId });
}

/** Estuda o Pipo a partir de uma execução real (a última, se não disser qual). */
export async function improvePipo(pipoId: number, deps: ImproveDeps, o: { runId?: number } = {}): Promise<PipoImprovement> {
  if (busy) throw new Error('Já tem um Pipo se aprimorando agora; tente daqui a pouco.');
  const pipo = getPipo(pipoId);
  if (!pipo) throw new Error('Pipo não encontrado.');
  const active = activePlaybook(pipoId);
  if (!active) throw new Error(`${pipo.name} ainda não tem um plano contratado.`);
  const run = o.runId ? getRun(o.runId) : lastRun(pipoId, false);
  if (!run || run.pipoId !== pipoId || run.dryRun) throw new Error(`Rode o ${pipo.name} de verdade pelo menos uma vez antes.`);
  busy = true;
  const imp = createImprovement(pipoId, active.version, run.id);
  changed(pipoId);
  try {
    const env = envOf(pipo);
    const input = runInput(pipo, run.id);
    const base = await deps.rehearse(pipo, active.playbook, input);
    const context = [pipoText(pipo, active.playbook), runText(pipo, run), rehearsalText('plano atual', base)].join('\n\n');
    const geral = await propose('geral', context, deps, active.playbook, env);
    const assunto = await propose('assunto', context, deps, active.playbook, env);
    const cands = ([['geral', geral], ['assunto', assunto]] as const).filter((x): x is readonly ['geral' | 'assunto', Candidate] => !!x[1] && !x[1].manter && !!x[1].plano);
    if (!cands.length) {
      const why = [geral?.motivo, assunto?.motivo].filter(Boolean).join(' ');
      return finishImprovement(imp.id, { status: 'kept', note: why || 'Nenhuma mudança teve evidência suficiente; o plano continua como está.' });
    }
    const parts: string[] = [context];
    for (const [label, c] of cands) {
      const probe = await deps.rehearse(pipo, c.plano as PipoPlaybook, input);
      parts.push(
        [`## Candidata "${label}"`, 'Mudanças:', ...c.mudancas.map((m) => `- ${m.mudanca} (porque: ${m.porque}; evidência: ${m.evidencia})`), c.regras.length ? `Regras novas: ${c.regras.join(' | ')}` : null, 'Plano (JSON):', JSON.stringify(c.plano), rehearsalText(`candidata "${label}"`, probe)]
          .filter(Boolean)
          .join('\n'),
      );
    }
    const comp = await compose(parts.join('\n\n'), deps, active.playbook, env);
    if (!comp) return finishImprovement(imp.id, { status: 'failed', note: 'Não consegui juntar as melhorias num plano válido.' });
    if (comp.licao && comp.licao.confianca !== 'baixa') addLesson({ pipoId, cue: comp.licao.situacao || pipo.personality.mission, lesson: comp.licao.licao, evidence: comp.licao.evidencia, confidence: comp.licao.confianca });
    if (comp.decisao === 'manter' || !comp.plano) return finishImprovement(imp.id, { status: 'kept', note: comp.motivo ?? 'Os ensaios não mostraram ganho; o plano continua como está.' });
    // A versão final passa por mais um ensaio: se o atual passava e ela não, não vale sugerir.
    const final = await deps.rehearse(pipo, comp.plano, input);
    if (final.status !== 'done' && base.status === 'done') return finishImprovement(imp.id, { status: 'kept', note: `A versão juntada falhou no ensaio (${final.error ?? final.status}); o plano continua como está.` });
    const note = comp.efeitos.length ? comp.efeitos.map((e) => `${e.mudanca}: ${e.veredito}`).join('; ') : null;
    return finishImprovement(imp.id, { status: 'pending', playbook: comp.plano, changes: comp.mudancas, rules: comp.regras, note });
  } catch (e) {
    return finishImprovement(imp.id, { status: 'failed', note: msg(e) });
  } finally {
    busy = false;
    changed(pipoId);
  }
}

/** Aplica (vira nova versão, com as regras novas) ou descarta uma sugestão. */
export function decideImprovement(id: number, decision: 'apply' | 'reject'): PipoImprovement {
  const imp = getImprovement(id);
  if (!imp || imp.status !== 'pending') throw new Error('Essa sugestão não está mais pendente.');
  const pipo = getPipo(imp.pipoId);
  if (!pipo) throw new Error('Pipo não encontrado.');
  if (decision === 'apply') {
    const plan = improvementPlaybook(id);
    if (!plan) throw new Error('A sugestão não tem plano.');
    if (activePlaybook(pipo.id)?.version !== imp.baseVersion) throw new Error('O plano mudou depois da sugestão; peça um estudo novo.');
    addVersion(pipo.id, plan, `Aprimorado: ${imp.changes.map((c) => c.mudanca).join('; ')}`.slice(0, 400));
    for (const r of imp.rules) addMemory(pipo.id, r, 'aprimorar');
  }
  decideImprovementRow(id, decision === 'apply' ? 'applied' : 'rejected');
  pipesChanged();
  changed(pipo.id);
  return getImprovement(id) as PipoImprovement;
}

/** Card no notch com a sugestão (entra no orçamento de interrupções). */
async function offer(imp: PipoImprovement): Promise<void> {
  const pipo = getPipo(imp.pipoId);
  if (!pipo) return;
  const n = imp.changes.length;
  const answer = await interruptions.request({
    type: 'pipo',
    queueable: true,
    fallbackExpression: 'happy',
    card: {
      kind: 'pipo_improve',
      glow: 'done',
      mascot: 'happy',
      pipoColor: PIPO_COLORS[pipo.color],
      label: `${pipo.name} pode melhorar`,
      title: n === 1 ? '1 mudança sugerida' : `${n} mudanças sugeridas`,
      list: imp.changes.map((c) => ({ title: c.mudanca, detail: c.porque })),
      buttons: [
        { id: 'later', label: 'Depois', kbd: 'N', variant: 'secondary' },
        { id: 'reject', label: 'Descartar', variant: 'tertiary' },
        { id: 'apply', label: 'Aplicar', kbd: 'Y', variant: 'primary' },
      ],
    },
  });
  if (answer === 'apply' || answer === 'reject') {
    try {
      decideImprovement(imp.id, answer);
      if (answer === 'apply') emit('toast:show', { id: `imp:${imp.id}`, text: `${pipo.name} aprimorado: nova versão no ar.`, durationMs: 5000 });
    } catch (e) {
      emit('toast:show', { id: `imp:${imp.id}`, text: msg(e), durationMs: 6000 });
    }
  }
}

const realDeps: ImproveDeps = {
  ask: async (system, prompt) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15 * 60_000);
    try {
      return await runRaw({ system, prompt, model: 'opus', effort: 'high', readDirs: [], signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  },
  rehearse: async (pipo, playbook, input) => {
    const runId = await startRun(pipo.id, { dryRun: true, trigger: 'aprimorar', playbook, input });
    if (!runId) throw new Error('Não consegui ensaiar.');
    const r = await runDone(runId);
    return { status: r.status, error: r.error, steps: runSteps(runId).map((s) => ({ key: s.key, title: s.title, status: s.status, preview: s.preview, error: s.error })) };
  },
};

export function registerImprove(): void {
  closeOrphanImprovements();
  // Depois de cada execução real: estuda só se tiver motivo, no máximo uma vez a cada 20 horas.
  runnerHooks.finished.push((run) => {
    if (run.dryRun) return;
    const pipo = getPipo(run.pipoId);
    if (!pipo || !autoImproveOn(pipo.id) || !agentAvailable()) return;
    if (!shouldImprove(improveSignals(pipo, run))) return;
    setTimeout(() => {
      if (busy) return;
      void improvePipo(pipo.id, realDeps, { runId: run.id })
        .then((imp) => (imp.status === 'pending' ? offer(imp) : undefined))
        .catch((e) => console.warn('[aprimorar]', msg(e)));
    }, 90_000).unref?.();
  });

  handle('pipos:improvements', (pipoId) => ({ list: listImprovements(pipoId, 5), auto: autoImproveOn(pipoId), busy }));
  handle('pipos:improve', (pipoId) => {
    if (!agentAvailable()) throw new Error('O Claude não está disponível. Confira em Configurações → Integrações.');
    if (busy) throw new Error('Já tem um Pipo se aprimorando agora; tente daqui a pouco.');
    void improvePipo(pipoId, realDeps).catch((e) => emit('toast:show', { id: `imp:${pipoId}`, text: msg(e), durationMs: 6000 }));
  });
  handle('pipos:decideImprovement', (id, decision) => decideImprovement(id, decision));
  handle('pipos:setAutoImprove', (pipoId, on) => {
    setKV(autoKey(pipoId), on);
  });
}
