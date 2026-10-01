// Ferramentas do construtor de Pipos (/criarpipo e /editarpipo). Só aparecem na conversa de criação.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describePlaybook, normalizePlaybook, validatePlaybook, type PlanIssue } from '@shared/plan-check';
import { PIPO_COLORS, type EventSpec, type MetricDef, type PipoAccessory, type PipoColor, type PipoPlaybook, type PipoStep } from '@shared/pipos';
import type { AgentEffort, AgentModel } from '@shared/types';
import { emit } from '../bus';
import { dismissCard, showCard } from '../cards';
import { confirmAction } from '../mcp/confirm-bridge';
import { registerTools, type ToolCtx, type ToolDef } from '../mcp/tools';
import { paths } from '../paths';
import { startRun } from './deps';
import { closeDraft, getDraft, STAGES, updateDraft, type Draft, type DraftStage } from './drafts';
import { pipesChanged } from './ipc';
import { setLive } from './live';
import { readMcpConfig } from './mcp-client';
import { activePlaybook, addVersion, createPipo, ensurePipoDirs, getPipo, listPipos, pipoDir, runSteps, updatePipo } from './repo';
import { runDone } from './runner';
import { forgetSecretCard, trackSecretCard } from './secret-cards';
import { secretNames, validSecretName } from './secrets';

type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const COLORS = Object.keys(PIPO_COLORS) as PipoColor[];
const ACCESSORIES: PipoAccessory[] = ['none', 'cap', 'headset', 'magnifier', 'tie', 'bow', 'beanie', 'glasses', 'pencil'];

/** Ganchos da Fase 19 (gatilhos) e 20 (apresentação no chat do Pipo). */
export const builderHooks: {
  applyTriggers: (pipoId: number, t: Draft['data']['triggers']) => string[];
  introduce: (pipoId: number, text: string) => void;
} = { applyTriggers: () => [], introduce: () => undefined };

function draftOf(ctx: ToolCtx): Draft {
  const d = ctx.draftId ? getDraft(ctx.draftId) : null;
  if (!d) throw new Error('Não há rascunho de Pipo nesta conversa.');
  return d;
}

function pipoOf(d: Draft): NonNullable<ReturnType<typeof getPipo>> {
  const p = d.data.pipoId ? getPipo(d.data.pipoId) : null;
  if (!p) throw new Error('Primeiro defina nome e cor do Pipo com draft_pipo.');
  return p;
}

function stageAtLeast(d: Draft, stage: DraftStage): DraftStage {
  return STAGES.indexOf(stage) > STAGES.indexOf(d.stage) ? stage : d.stage;
}

export function emitDraft(d: Draft): void {
  const p = d.data.pipoId ? getPipo(d.data.pipoId) : null;
  emit('pipos:draft', { conversationId: d.conversationId, draftId: d.id, stage: d.stage, name: p?.name ?? null, color: p ? PIPO_COLORS[p.color] : null, editing: d.data.editing });
}

function scriptsOf(slug: string): string[] {
  const dir = join(pipoDir(slug), 'scripts');
  return existsSync(dir) ? readdirSync(dir) : [];
}

function checkPlan(d: Draft, plan: PipoPlaybook): PlanIssue[] {
  const p = d.data.pipoId ? getPipo(d.data.pipoId) : null;
  return validatePlaybook(plan, {
    secrets: p ? secretNames(p.slug) : [],
    scripts: p ? scriptsOf(p.slug) : [],
    pipos: listPipos().map((x) => x.slug),
    mcpServers: p ? Object.keys(readMcpConfig(pipoDir(p.slug))) : [],
  });
}

function planReply(d: Draft, plan: PipoPlaybook): Record<string, unknown> {
  const issues = checkPlan(d, plan);
  return { passos: describePlaybook(plan), metricas: plan.metrics.map((m) => `${m.key}: ${m.label}`), problemas: issues.length ? issues : 'nenhum' };
}

function savePlan(d: Draft, plan: PipoPlaybook): Draft {
  const next = updateDraft(d.id, { data: { plan: normalizePlaybook(plan), rehearsal: null }, stage: stageAtLeast(d, 'plan') });
  emitDraft(next);
  return next;
}

function asSteps(v: unknown): PipoStep[] {
  if (!Array.isArray(v)) throw new Error('steps precisa ser uma lista de passos.');
  return v as PipoStep[];
}

let planCardId: string | null = null;

/** Card do plano no chat (não bloqueia a conversa). */
function showPlanCard(d: Draft, plan: PipoPlaybook): void {
  const p = pipoOf(d);
  if (planCardId) dismissCard(planCardId, 'replaced');
  const t = d.data.triggers;
  const when = [t.schedule ? `quando: ${t.schedule}` : null, t.after ? `depois de @${t.after.from}${t.after.delayMin ? ` (+${t.after.delayMin} min)` : ''}` : null, 'ou quando você pedir'].filter(Boolean).join(' · ');
  const issues = checkPlan(d, plan);
  planCardId = `plan:${d.id}:${Date.now()}`;
  void showCard({
    id: planCardId,
    kind: 'pipo_plan',
    glow: 'none',
    mascot: 'happy',
    pipoColor: PIPO_COLORS[p.color],
    label: `plano de execução · ${p.name}`,
    subject: when,
    list: describePlaybook(plan),
    body: [
      plan.metrics.length ? `Conta: ${plan.metrics.map((m) => m.label).join(', ')}` : null,
      `Tempo máximo: ${plan.limits.maxRunMinutes} min${plan.limits.window ? ` · só entre ${plan.limits.window.start} e ${plan.limits.window.end}` : ''}`,
      issues.length ? issues.map((i) => `${i.level === 'error' ? '✕' : '!'} ${i.step ? `${i.step}: ` : ''}${i.message}`).join('\n') : null,
    ]
      .filter(Boolean)
      .join('\n'),
    buttons: [{ id: 'ok', label: 'Ok', variant: 'secondary' }],
  }).then(() => {
    planCardId = null;
  });
}

async function dryRun(d: Draft, plan: PipoPlaybook, upTo?: string): Promise<Record<string, unknown>> {
  const p = pipoOf(d);
  const steps = upTo ? plan.steps.slice(0, plan.steps.findIndex((s) => s.key === upTo) + 1) : plan.steps;
  if (!steps.length) throw new Error(upTo ? `Passo "${upTo}" não existe.` : 'O plano está vazio.');
  const runId = await startRun(p.id, { dryRun: true, trigger: 'rehearsal', playbook: { ...plan, steps }, input: null });
  if (!runId) throw new Error('Não consegui começar o ensaio.');
  const run = await runDone(runId);
  return {
    status: run.status,
    erro: run.error,
    metricas: run.metrics,
    passos: runSteps(runId).map((s) => ({ passo: s.key, status: s.status, saida: s.preview, erro: s.error })),
    run_id: runId,
  };
}

const TOOLS: ToolDef[] = [
  {
    name: 'draft_pipo',
    modes: ['builder'],
    description:
      'Cria ou atualiza a identidade do Pipo em construção: nome, cor, acessório, missão, tom, o que nunca faz, modelo e se roda em folgas. Chame assim que souber o nome (o mini-Pipo aparece tracejado na pill) e de novo a cada ajuste.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'string', enum: COLORS },
        accessory: { type: 'string', enum: ACCESSORIES },
        mission: { type: 'string', description: 'Missão em uma frase, na voz do Pipo.' },
        tone: { type: 'string', description: 'Como ele escreve para terceiros e como fala com o usuário.' },
        never: { type: 'array', items: { type: 'string' } },
        model: { type: 'string', enum: ['sonnet', 'opus', 'haiku'] },
        effort: { type: 'string', enum: ['low', 'medium', 'high'] },
        run_on_days_off: { type: 'boolean' },
      },
    },
    run: (a: Args, ctx) => {
      const d = draftOf(ctx);
      const color = (COLORS.includes(a.color as PipoColor) ? a.color : undefined) as PipoColor | undefined;
      const accessory = (ACCESSORIES.includes(a.accessory as PipoAccessory) ? a.accessory : undefined) as PipoAccessory | undefined;
      const existing = d.data.pipoId ? getPipo(d.data.pipoId) : null;
      const personality = {
        mission: str(a.mission) ?? existing?.personality.mission ?? '',
        tone: str(a.tone) ?? existing?.personality.tone ?? '',
        never: Array.isArray(a.never) ? a.never.map(String).filter(Boolean) : (existing?.personality.never ?? []),
      };
      const model = a.model as AgentModel | undefined;
      const effort = a.effort as AgentEffort | undefined;
      let pipo = existing;
      if (!pipo) {
        const name = str(a.name);
        if (!name) throw new Error('Diga o nome do Pipo.');
        // Cor livre: a primeira que ninguém da equipe usa.
        const used = new Set(listPipos().map((x) => x.color));
        pipo = createPipo({ name, color: color ?? COLORS.find((c) => !used.has(c)) ?? 'orange', accessory, personality, model, effort, runOnDaysOff: a.run_on_days_off === true });
      } else {
        pipo = updatePipo(pipo.id, {
          name: str(a.name) ?? pipo.name,
          color: color ?? pipo.color,
          accessory: accessory ?? pipo.accessory,
          personality,
          model: model ?? pipo.model,
          effort: effort ?? pipo.effort,
          runOnDaysOff: typeof a.run_on_days_off === 'boolean' ? a.run_on_days_off : pipo.runOnDaysOff,
        });
      }
      if (!pipo.activeVersion) setLive(pipo.id, 'draft');
      const next = updateDraft(d.id, { data: { pipoId: pipo.id }, stage: stageAtLeast(d, 'personality') });
      emitDraft(next);
      pipesChanged();
      return { pipo: { nome: pipo.name, slug: pipo.slug, cor: pipo.color, acessorio: pipo.accessory, missao: pipo.personality.mission, tom: pipo.personality.tone, nunca: pipo.personality.never, modelo: pipo.model }, etapa: next.stage };
    },
  },
  {
    name: 'set_stage',
    modes: ['builder'],
    description: 'Avança a barra de progresso da criação: start, personality, interview, connections, plan, rehearsal, hire.',
    inputSchema: { type: 'object', properties: { stage: { type: 'string', enum: STAGES } }, required: ['stage'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const stage = a.stage as DraftStage;
      if (!STAGES.includes(stage)) throw new Error('Etapa inválida.');
      const next = updateDraft(d.id, { stage });
      emitDraft(next);
      return { etapa: next.stage };
    },
  },
  {
    name: 'save_interview',
    modes: ['builder'],
    description:
      'Guarda a resposta de um item do roteiro de entrevista (gatilho, origem_dos_dados, o_que_fazer, destino, limites, quando_avisar, quando_pedir_permissao, folgas, depende_de_outro). Use "não se aplica" quando for o caso.',
    inputSchema: { type: 'object', properties: { item: { type: 'string' }, answer: { type: 'string' } }, required: ['item', 'answer'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const item = str(a.item);
      if (!item) throw new Error('item vazio');
      const interview = { ...d.data.interview, [item]: String(a.answer ?? '') };
      const next = updateDraft(d.id, { data: { interview }, stage: stageAtLeast(d, 'interview') });
      emitDraft(next);
      const required = ['gatilho', 'origem_dos_dados', 'o_que_fazer', 'destino', 'limites', 'quando_avisar', 'quando_pedir_permissao', 'folgas', 'depende_de_outro'];
      return { respondidos: Object.keys(interview), faltam: required.filter((r) => !(r in interview)) };
    },
  },
  {
    name: 'set_plan',
    modes: ['builder'],
    description:
      'Define o plano de execução inteiro (substitui o anterior). Use passos determinísticos sempre que der e `agent` só onde precisa de julgamento. Devolve os problemas encontrados.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'object' }, description: 'Lista de passos (formato no prompt de sistema).' },
        metrics: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, from: { type: 'string' }, stage: { type: 'number' } } } },
        max_run_minutes: { type: 'number' },
        window: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } } },
        saved_minutes_per_run: { type: 'number' },
      },
      required: ['steps'],
    },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const w = a.window as { start?: string; end?: string } | undefined;
      const plan: PipoPlaybook = {
        steps: asSteps(a.steps),
        metrics: Array.isArray(a.metrics) ? (a.metrics as MetricDef[]) : d.data.plan.metrics,
        limits: { maxRunMinutes: typeof a.max_run_minutes === 'number' ? a.max_run_minutes : d.data.plan.limits.maxRunMinutes, window: w?.start && w.end ? { start: w.start, end: w.end } : (d.data.plan.limits.window ?? null) },
        savedMinutesPerRun: typeof a.saved_minutes_per_run === 'number' ? a.saved_minutes_per_run : d.data.plan.savedMinutesPerRun,
      };
      const next = savePlan(d, plan);
      return planReply(next, next.data.plan);
    },
  },
  {
    name: 'edit_step',
    modes: ['builder'],
    description: 'Altera campos de um passo do plano (merge). Ex.: {"key":"enviar","changes":{"title":"Enviar no máximo 30"}}.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, changes: { type: 'object' } }, required: ['key', 'changes'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const steps = d.data.plan.steps.map((s) => (s.key === a.key ? ({ ...s, ...(a.changes as object) } as PipoStep) : s));
      if (!steps.some((s) => s.key === a.key)) throw new Error(`Passo "${String(a.key)}" não existe.`);
      const next = savePlan(d, { ...d.data.plan, steps });
      return planReply(next, next.data.plan);
    },
  },
  {
    name: 'add_step',
    modes: ['builder'],
    description: 'Adiciona um passo ao plano (depois do passo `after`, ou no fim).',
    inputSchema: { type: 'object', properties: { step: { type: 'object' }, after: { type: 'string' } }, required: ['step'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const steps = [...d.data.plan.steps];
      const i = a.after ? steps.findIndex((s) => s.key === a.after) : steps.length - 1;
      steps.splice(i + 1, 0, a.step as PipoStep);
      const next = savePlan(d, { ...d.data.plan, steps });
      return planReply(next, next.data.plan);
    },
  },
  {
    name: 'remove_step',
    modes: ['builder'],
    description: 'Tira um passo do plano.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const next = savePlan(d, { ...d.data.plan, steps: d.data.plan.steps.filter((s) => s.key !== a.key) });
      return planReply(next, next.data.plan);
    },
  },
  {
    name: 'set_triggers',
    modes: ['builder'],
    description:
      'Define quando o Pipo roda (além de quando o usuário pede): agenda em linguagem natural ("seg–sex 9h", "a cada 2h das 8 às 18"), depois de outro Pipo, ou eventos (email_label, folder, meeting_end).',
    inputSchema: {
      type: 'object',
      properties: {
        schedule: { type: ['string', 'null'] },
        after: { type: ['object', 'null'], properties: { from: { type: 'string' }, delay_min: { type: 'number' } } },
        events: { type: 'array', items: { type: 'object' } },
      },
    },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const after = a.after && typeof a.after === 'object' ? { from: String((a.after as Args).from ?? '').replace(/^@/, ''), delayMin: Number((a.after as Args).delay_min ?? 0) } : a.after === null ? null : d.data.triggers.after;
      const triggers = {
        schedule: a.schedule === undefined ? d.data.triggers.schedule : (str(a.schedule) ?? null),
        after: after && after.from ? after : null,
        events: Array.isArray(a.events) ? (a.events as EventSpec[]) : d.data.triggers.events,
      };
      const next = updateDraft(d.id, { data: { triggers } });
      emitDraft(next);
      return { gatilhos: triggers };
    },
  },
  {
    name: 'request_secret',
    modes: ['builder'],
    description:
      'Pede ao usuário uma chave/token (ex.: APIFY_TOKEN) num campo seguro do notch. O valor vai direto para o cofre do Pipo; você nunca vê o valor. NUNCA peça segredos pelo chat.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'MAIÚSCULAS_COM_UNDERSCORE' }, why: { type: 'string', description: 'Para que serve e onde o usuário encontra.' } }, required: ['name', 'why'] },
    run: async (a, ctx) => {
      const d = draftOf(ctx);
      const p = pipoOf(d);
      const name = String(a.name ?? '').toUpperCase();
      if (!validSecretName(name)) throw new Error('Nome inválido: use MAIÚSCULAS, números e _ (ex.: APIFY_TOKEN).');
      updateDraft(d.id, { stage: stageAtLeast(d, 'connections') });
      emitDraft(getDraft(d.id) as Draft);
      const cardId = `secret:${d.id}:${name}:${Date.now()}`;
      trackSecretCard(cardId, p.id, name);
      const answer = await showCard(
        {
          id: cardId,
          kind: 'pipo_secret',
          glow: 'attention',
          mascot: 'listening',
          pipoColor: PIPO_COLORS[p.color],
          label: `${p.name} · chave segura`,
          title: name,
          body: String(a.why ?? ''),
          secret: { pipoId: p.id, name },
          buttons: [{ id: 'cancel', label: 'Agora não', variant: 'tertiary' }],
        },
        { timeoutMs: 10 * 60_000 },
      );
      forgetSecretCard(cardId);
      return answer === 'saved' ? { [name]: 'salvo no cofre' } : { [name]: 'o usuário não informou agora' };
    },
  },
  {
    name: 'write_script',
    modes: ['builder'],
    description:
      'Escreve um script em scripts/ do Pipo (node .js/.mjs, python .py, powershell .ps1, bash .sh). O script deve: ler segredos de variáveis de ambiente, ler a entrada de PIPO_INPUT (arquivo JSON), respeitar PIPO_DRY_RUN=1 (não enviar/escrever nada fora) e imprimir o resultado como JSON no stdout. Pede confirmação ao usuário.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, content: { type: 'string' } }, required: ['file', 'content'] },
    run: async (a, ctx) => {
      const d = draftOf(ctx);
      const p = pipoOf(d);
      const file = String(a.file ?? '').replace(/^scripts\//, '');
      if (!/^[\w.-]+\.(js|mjs|cjs|py|ps1|sh)$/.test(file)) throw new Error('Nome de arquivo inválido (ex.: puxar_leads.js).');
      const content = String(a.content ?? '');
      const ok = await confirmAction('write_script', {
        label: `${p.name} · script`,
        subject: `scripts/${file} (${content.split('\n').length} linhas)`,
        title: content.split('\n').slice(0, 3).join(' ⏎ ').slice(0, 140),
        confirm: 'Salvar script',
        allowAlways: false,
      });
      if (!ok) return { salvo: false, motivo: 'O usuário recusou.' };
      writeFileSync(join(ensurePipoDirs(p.slug), 'scripts', file), content);
      return { salvo: `scripts/${file}` };
    },
  },
  {
    name: 'import_script',
    modes: ['builder'],
    description: 'Copia um arquivo que o usuário anexou na conversa para scripts/ do Pipo.',
    inputSchema: { type: 'object', properties: { attachment_path: { type: 'string' }, name: { type: 'string' } }, required: ['attachment_path'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      const p = pipoOf(d);
      const src = resolve(String(a.attachment_path ?? ''));
      if (!src.startsWith(resolve(paths.files) + sep) || !existsSync(src)) throw new Error('Só arquivos anexados nesta conversa podem ser importados.');
      const name = (str(a.name) ?? src.split(/[\\/]/).pop() ?? 'script').replace(/[^\w.-]/g, '_');
      writeFileSync(join(ensurePipoDirs(p.slug), 'scripts', name), readFileSync(src));
      return { importado: `scripts/${name}` };
    },
  },
  {
    name: 'add_mcp_server',
    modes: ['builder'],
    description: 'Adiciona um servidor MCP stdio ao Pipo (ex.: o MCP oficial de um serviço), para usar em passos `mcp`. Pede confirmação. Use {{segredo.NOME}} no env.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, env: { type: 'object' } }, required: ['name', 'command'] },
    run: async (a, ctx) => {
      const d = draftOf(ctx);
      const p = pipoOf(d);
      const name = String(a.name ?? '').trim();
      if (!/^[\w-]+$/.test(name)) throw new Error('Nome inválido.');
      const args = Array.isArray(a.args) ? a.args.map(String) : [];
      const ok = await confirmAction('add_mcp_server', { label: `${p.name} · servidor MCP`, subject: `${name}: ${String(a.command)} ${args.join(' ')}`.slice(0, 160), confirm: 'Adicionar', allowAlways: false });
      if (!ok) return { adicionado: false };
      const dir = ensurePipoDirs(p.slug);
      const servers = { ...readMcpConfig(dir), [name]: { command: String(a.command), args, env: (a.env as Record<string, string>) ?? {} } };
      writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));
      return { adicionado: name };
    },
  },
  {
    name: 'test_step',
    modes: ['builder'],
    description: 'Testa o plano em modo seco até o passo indicado (inclusive). Nada sai da máquina. Devolve a saída de cada passo.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: (a, ctx) => {
      const d = draftOf(ctx);
      return dryRun(d, d.data.plan, String(a.key));
    },
  },
  {
    name: 'rehearse',
    modes: ['builder'],
    description: 'Ensaio completo em modo seco, com prévia de tudo que seria enviado ou escrito. Obrigatório antes de contratar.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, ctx) => {
      const d = draftOf(ctx);
      const issues = checkPlan(d, d.data.plan).filter((i) => i.level === 'error');
      if (issues.length) return { status: 'plano com erros', problemas: issues };
      const r = await dryRun(d, d.data.plan);
      const next = updateDraft(d.id, { data: { rehearsal: { runId: Number(r.run_id), ok: r.status === 'done' } }, stage: stageAtLeast(d, 'rehearsal') });
      emitDraft(next);
      return r;
    },
  },
  {
    name: 'propose_plan',
    modes: ['builder'],
    description: 'Mostra o plano de execução como um card legível no chat (passos numerados, confirmações, limites, gatilhos).',
    inputSchema: { type: 'object', properties: {} },
    run: (_a, ctx) => {
      const d = draftOf(ctx);
      showPlanCard(d, d.data.plan);
      return planReply(d, d.data.plan);
    },
  },
  {
    name: 'hire_pipo',
    modes: ['builder'],
    description: 'Contrata o Pipo: o plano ensaiado vira a versão fixa (v1, ou nova versão no /editarpipo) e os gatilhos passam a valer. Pede confirmação.',
    inputSchema: { type: 'object', properties: { changelog: { type: 'string' }, intro: { type: 'string', description: 'Apresentação curta do Pipo, na voz dele (como roda e como chamar).' } } },
    run: async (a, ctx) => {
      const d = draftOf(ctx);
      const p = pipoOf(d);
      const plan = d.data.plan;
      const errors = checkPlan(d, plan).filter((i) => i.level === 'error');
      if (errors.length) return { contratado: false, problemas: errors };
      if (!d.data.rehearsal?.ok) return { contratado: false, motivo: 'Faça um ensaio (rehearse) que passe antes de contratar.' };
      const prev = d.data.editing ? activePlaybook(p.id) : null;
      const diff = prev ? planDiff(prev.playbook, plan) : null;
      const answer = await showCard(
        {
          kind: 'action',
          glow: 'done',
          mascot: 'happy',
          pipoColor: PIPO_COLORS[p.color],
          label: d.data.editing ? `${p.name} · nova versão` : 'contratar Pipo',
          subject: d.data.editing ? `v${(prev?.version ?? 0) + 1}: ${diff?.join('; ') || 'sem mudanças nos passos'}` : `${p.name}: ${p.personality.mission}`,
          list: describePlaybook(plan),
          buttons: [
            { id: 'no', label: 'Ainda não', kbd: 'N', variant: 'secondary' },
            { id: 'yes', label: d.data.editing ? 'Salvar nova versão' : 'Contratar Pipo', kbd: 'Y', variant: 'primary' },
          ],
        },
        { timeoutMs: 10 * 60_000, timeoutValue: 'no' },
      );
      if (answer !== 'yes') return { contratado: false, motivo: 'O usuário quer ajustar mais.' };
      if (planCardId) dismissCard(planCardId, 'hired');
      const v = addVersion(p.id, plan, str(a.changelog) ?? (d.data.editing ? (diff?.join('; ') ?? 'ajustes') : 'primeira versão'));
      const triggers = builderHooks.applyTriggers(p.id, d.data.triggers);
      updateDraft(d.id, { stage: 'hire' });
      closeDraft(d.id);
      emitDraft({ ...d, stage: 'hire' });
      setLive(p.id, 'done');
      pipesChanged();
      emit('pipos:hired', { pipoId: p.id, version: v.version });
      const intro = str(a.intro) ?? `Oi, sou o ${p.name}. ${p.personality.mission} Me chama com @${p.slug}.`;
      builderHooks.introduce(p.id, intro);
      return { contratado: true, versao: v.version, gatilhos: triggers, slug: p.slug };
    },
  },
  {
    name: 'list_team',
    modes: ['builder', 'chat', 'pipo'],
    description: 'Lista os Pipos coloridos da equipe (slug, missão, se está pausado, última execução).',
    inputSchema: { type: 'object', properties: {} },
    run: () => listPipos().map((p) => ({ slug: p.slug, nome: p.name, cor: p.color, missao: p.personality.mission, pausado: p.paused, contratado: !!p.activeVersion })),
  },
];

/** Resumo legível do que mudou entre duas versões do plano. */
export function planDiff(a: PipoPlaybook, b: PipoPlaybook): string[] {
  const out: string[] = [];
  const ka = new Map(a.steps.map((s) => [s.key, s]));
  const kb = new Map(b.steps.map((s) => [s.key, s]));
  for (const s of b.steps) if (!ka.has(s.key)) out.push(`+ ${s.title}`);
  for (const s of a.steps) if (!kb.has(s.key)) out.push(`− ${s.title}`);
  for (const s of b.steps) {
    const old = ka.get(s.key);
    if (old && JSON.stringify(old) !== JSON.stringify(s)) out.push(`~ ${s.title}`);
  }
  if (a.steps.map((s) => s.key).join() !== b.steps.map((s) => s.key).join() && !out.length) out.push('ordem dos passos');
  if (JSON.stringify(a.metrics) !== JSON.stringify(b.metrics)) out.push('métricas');
  if (JSON.stringify(a.limits) !== JSON.stringify(b.limits)) out.push('limites');
  return out;
}

export function registerBuilderTools(): void {
  registerTools(TOOLS);
}
