// Conversa com um Pipo colorido (Fase 20): o chat de sempre, na cor e com a personalidade dele.
// Ele explica o plano, mostra execuções, roda quando pedem e aprende regras; o plano só muda pelo /editarpipo.
import { describePlaybook } from '@shared/plan-check';
import { PIPO_COLORS } from '@shared/pipos';
import { promptHooks } from '../agent/service';
import { addMessage, createConversation, getConversation } from '../db/repos/conversations';
import { getProfile } from '../db/repos/profile';
import { getKV, setKV } from '../db/repos/settings';
import { db } from '../db';
import { handle } from '../ipc';
import { registerTools, type ToolCtx } from '../mcp/tools';
import { builderHooks } from './builder-tools';
import { startRun } from './deps';
import { pipesChanged } from './ipc';
import { activePlaybook, addMemory, deleteMemory, getPipo, getRun, listMemory, listRuns, runSteps } from './repo';
import { nextRunAt, scheduleLabel } from './triggers';

const convKey = (pipoId: number): string => `pipo:conv:${pipoId}`;
const ownerKey = (conversationId: number): string => `conv:pipo:${conversationId}`;

/** Conversa do Pipo (cria na primeira vez). */
export function pipoConversation(pipoId: number): number {
  const id = getKV<number | null>(convKey(pipoId), null);
  if (id && getConversation(id)) return id;
  const p = getPipo(pipoId);
  const conv = createConversation();
  setKV(convKey(pipoId), conv.id);
  setKV(ownerKey(conv.id), pipoId);
  if (p) addMessage(conv.id, 'assistant', `Oi, sou o ${p.name}. ${p.personality.mission} Me chama com @${p.slug}.`);
  return conv.id;
}

export function conversationOwner(conversationId: number): number | null {
  const id = getKV<number | null>(ownerKey(conversationId), null);
  return id && getPipo(id) ? id : null;
}

function pipoOf(ctx: ToolCtx): NonNullable<ReturnType<typeof getPipo>> {
  const p = ctx.pipoId ? getPipo(ctx.pipoId) : null;
  if (!p) throw new Error('Esta conversa não é de um Pipo colorido.');
  return p;
}

function buildPipoPrompt(pipoId: number): string {
  const p = getPipo(pipoId);
  if (!p) return '';
  const v = activePlaybook(pipoId);
  const rules = listMemory(pipoId).map((m) => m.rule);
  const last = listRuns(pipoId, 3).filter((r) => !r.dryRun);
  const user = getProfile()?.name || 'o usuário';
  return [
    `Você é o Pipo ${p.name} (@${p.slug}), um Pipo colorido da equipe de ${user}. Você conversa com ${user} sobre o seu trabalho.`,
    `Missão: ${p.personality.mission || '—'}. Tom: ${p.personality.tone || 'direto e simpático'}. Você nunca: ${p.personality.never.join('; ') || '—'}.`,
    rules.length ? `Regras que você aprendeu (siga sempre):\n${rules.map((r) => `- ${r}`).join('\n')}` : 'Ainda não aprendeu regras específicas.',
    v ? `Seu plano de execução fixo (v${v.version}):\n${describePlaybook(v.playbook).map((s) => `${s.title} — ${s.detail}`).join('\n')}` : 'Você ainda não tem um plano contratado.',
    `Quando roda: ${scheduleLabel(pipoId) ?? 'só quando pedem'}${nextRunAt(pipoId) ? ` (próxima: ${new Date(nextRunAt(pipoId) as string).toLocaleString('pt-BR')})` : ''}${p.paused ? ' — PAUSADO' : ''}.`,
    last.length ? `Últimas execuções: ${last.map((r) => `#${r.id} ${r.status} — ${r.summary ?? r.error ?? ''}`).join(' | ')}` : 'Ainda não rodou de verdade.',
    'Fale em português do Brasil, curto (o chat é pequeno), na primeira pessoa. Sem markdown pesado.',
    'Use my_runs e run_detail para responder sobre execuções (por que falhou, o que foi enviado). Nunca invente números.',
    'Se pedirem para rodar, chame run_me. Se o usuário corrigir algo que vale para sempre ("não manda pra concorrente X"), chame remember com a regra curta.',
    `Você NÃO muda o próprio plano. Se pedirem mudança de passos, limites ou horário, explique e sugira "/editarpipo ${p.slug}".`,
  ].join('\n');
}

export function registerPipoChat(): void {
  promptHooks.pipo = buildPipoPrompt;
  const prev = promptHooks.modeFor;
  promptHooks.modeFor = (conversationId) => {
    const r = prev?.(conversationId);
    if (r) return r;
    const pipoId = conversationOwner(conversationId);
    return pipoId ? { mode: 'pipo', pipoId } : null;
  };
  // Apresentação do Pipo recém-contratado no chat dele.
  builderHooks.introduce = (pipoId, text) => {
    const conv = pipoConversation(pipoId);
    addMessage(conv, 'assistant', text);
  };

  registerTools([
    {
      name: 'my_plan',
      modes: ['pipo'],
      description: 'Seu plano de execução atual, gatilhos e limites.',
      inputSchema: { type: 'object', properties: {} },
      run: (_a, ctx) => {
        const p = pipoOf(ctx);
        const v = activePlaybook(p.id);
        return { versao: v?.version ?? null, passos: v ? describePlaybook(v.playbook) : [], limites: v?.playbook.limits, metricas: v?.playbook.metrics, agenda: scheduleLabel(p.id), pausado: p.paused };
      },
    },
    {
      name: 'my_runs',
      modes: ['pipo'],
      description: 'Suas últimas execuções (status, resumo, métricas, erro).',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      run: (a, ctx) => {
        const p = pipoOf(ctx);
        return listRuns(p.id, Math.min(30, Number(a.limit ?? 10))).map((r) => ({ id: r.id, status: r.status, ensaio: r.dryRun, quando: r.startedAt, gatilho: r.trigger, resumo: r.summary, metricas: r.metrics, erro: r.error }));
      },
    },
    {
      name: 'run_detail',
      modes: ['pipo'],
      description: 'Passo a passo de uma execução: status, saída resumida e erro de cada passo.',
      inputSchema: { type: 'object', properties: { run_id: { type: 'number' } }, required: ['run_id'] },
      run: (a, ctx) => {
        const p = pipoOf(ctx);
        const r = getRun(Number(a.run_id));
        if (!r || r.pipoId !== p.id) throw new Error('Execução não encontrada.');
        return { execucao: { id: r.id, status: r.status, resumo: r.summary, erro: r.error }, passos: runSteps(r.id).map((s) => ({ passo: s.title, status: s.status, saida: s.preview, erro: s.error })) };
      },
    },
    {
      name: 'run_me',
      modes: ['pipo'],
      description: 'Roda o seu plano agora (ou em modo seco, sem efeitos fora da máquina).',
      inputSchema: { type: 'object', properties: { dry_run: { type: 'boolean' } } },
      run: async (a, ctx) => {
        const p = pipoOf(ctx);
        const runId = await startRun(p.id, { dryRun: a.dry_run === true, trigger: 'chat' });
        return { comecou: !!runId, execucao: runId };
      },
    },
    {
      name: 'remember',
      modes: ['pipo'],
      description: 'Guarda uma regra que o usuário ensinou e que vale para todas as execuções (aparece na Equipe, editável). Pede confirmação.',
      inputSchema: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] },
      confirm: (a, ctx) => {
        const p = ctx.pipoId ? getPipo(ctx.pipoId) : null;
        return { label: `${p?.name ?? 'Pipo'} · nova regra`, subject: String(a.rule ?? '').slice(0, 160), confirm: 'Guardar regra', allowAlways: true };
      },
      run: (a, ctx) => {
        const p = pipoOf(ctx);
        const rule = String(a.rule ?? '').trim();
        if (!rule) throw new Error('Regra vazia.');
        const m = addMemory(p.id, rule, 'chat');
        pipesChanged();
        return { guardada: m.rule };
      },
    },
  ]);

  handle('pipos:chat', (pipoId) => ({ conversationId: pipoConversation(pipoId) }));
  handle('pipos:chatOwner', (conversationId) => {
    const id = conversationOwner(conversationId);
    const p = id ? getPipo(id) : null;
    return p ? { id: p.id, name: p.name, slug: p.slug, color: PIPO_COLORS[p.color], accessory: p.accessory } : null;
  });
  handle('pipos:addMemory', (pipoId, rule) => {
    addMemory(pipoId, rule, 'manual');
    pipesChanged();
  });
  handle('pipos:updateMemory', (id, rule) => {
    db().run('UPDATE pipo_memory SET rule = ? WHERE id = ?', rule.trim(), id);
    pipesChanged();
  });
  handle('pipos:deleteMemory', (id) => {
    deleteMemory(id);
    pipesChanged();
  });
}
