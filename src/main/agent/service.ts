// Orquestra as conversas com o agente: provedor, prompt de sistema, contexto MCP, streaming e persistência.
import type { AgentEvent, Task } from '@shared/types';
import { parseCapture } from '@shared/parse-capture';
import { emit } from '../bus';
import { listClients } from '../db/repos/clients';
import {
  addMessage,
  createConversation,
  getAttachments,
  getConversation,
  listConversations,
  listMessages,
  setConversationSession,
  setConversationTitle,
} from '../db/repos/conversations';
import { goalForDate, getProfile } from '../db/repos/profile';
import { listRituals } from '../db/repos/rituals';
import { getKV, setKV } from '../db/repos/settings';
import { createTask, listTasks } from '../db/repos/tasks';
import { handle } from '../ipc';
import { closeContext, openContext } from '../mcp/server';
import type { ToolCtx } from '../mcp/tools';
import { paths } from '../paths';
import { getSecret, setSecret } from '../secrets';
import { tasksChanged } from '../tasks/ipc';
import { AnthropicApiProvider } from './api-provider';
import { ClaudeCodeProvider } from './claude-code-provider';
import { claudeStatus, markClaudeStatus } from './detect-claude';
import type { AgentProvider, ProviderEvent } from './provider';
import { buildSystemPrompt } from './system-prompt';

type ProviderId = 'claude-code' | 'anthropic-api';
const contextsById = new Map<string, ToolCtx>();
const running = new Map<number, AbortController>();

export function providerSetting(): { provider: ProviderId; hasKey: boolean } {
  return { provider: getKV<ProviderId>('agentProvider', 'claude-code'), hasKey: !!getSecret('anthropicApiKey') };
}

function provider(): AgentProvider {
  const s = providerSetting();
  const key = s.provider === 'anthropic-api' ? getSecret('anthropicApiKey') : null;
  if (key) return new AnthropicApiProvider(key, (id) => contextsById.get(id) ?? { mode: 'chat', conversationId: null });
  return new ClaudeCodeProvider();
}

export function agentAvailable(): boolean {
  const s = providerSetting();
  return (s.provider === 'anthropic-api' && s.hasKey) || claudeStatus().state === 'ok';
}

function systemPrompt(mode: 'chat' | 'capture'): string {
  return buildSystemPrompt({
    profile: getProfile(),
    rituals: listRituals(),
    clients: listClients(),
    goalTodayMin: goalForDate(getProfile(), new Date()),
    now: new Date(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    mode,
  });
}

/** Roda uma chamada ao provedor e repassa os eventos. */
async function run(opts: { conversationId: number | null; prompt: string; mode: 'chat' | 'capture'; sessionId: string | null; signal: AbortSignal; onEvent: (e: ProviderEvent) => void }): Promise<ProviderEvent & ({ type: 'done' } | { type: 'error' })> {
  const ctx: ToolCtx = { mode: opts.mode, conversationId: opts.conversationId };
  const ctxId = openContext(ctx);
  contextsById.set(ctxId, ctx);
  let last: (ProviderEvent & ({ type: 'done' } | { type: 'error' })) | null = null;
  try {
    for await (const e of provider().send({ prompt: opts.prompt, systemPrompt: systemPrompt(opts.mode), sessionId: opts.sessionId, mcpContext: ctxId, readDirs: [paths.files], signal: opts.signal })) {
      opts.onEvent(e);
      if (e.type === 'done' || e.type === 'error') last = e;
    }
  } finally {
    closeContext(ctxId);
    contextsById.delete(ctxId);
  }
  const result = last ?? { type: 'error', code: 'failed', message: 'Sem resposta do Claude.' };
  if (result.type === 'error' && result.code === 'not_logged' && providerSetting().provider === 'claude-code') {
    markClaudeStatus({ state: 'not_logged', version: null, message: result.message });
  }
  return result;
}

function promptWithAttachments(text: string, attachmentIds: number[]): string {
  const atts = getAttachments(attachmentIds);
  if (!atts.length) return text;
  const list = atts.map((a) => `- ${a.filename} (${a.mime}): ${a.path}`).join('\n');
  return `${text}\n\nArquivos anexados (leia com a ferramenta Read):\n${list}`;
}

export async function sendMessage(opts: { conversationId: number | null; text: string; attachmentIds?: number[] }): Promise<{ conversationId: number }> {
  const conv = opts.conversationId ? (getConversation(opts.conversationId) ?? createConversation()) : createConversation();
  const atts = opts.attachmentIds ?? [];
  addMessage(conv.id, 'user', opts.text, atts);
  setConversationTitle(conv.id, opts.text.split('\n')[0]);
  const ac = new AbortController();
  running.get(conv.id)?.abort();
  running.set(conv.id, ac);
  const send = (e: AgentEvent): void => emit('agent:event', e);
  send({ type: 'start', conversationId: conv.id });

  if (!agentAvailable()) {
    const msg = 'O Claude não está disponível. Confira em Configurações → Integrações.';
    send({ type: 'error', conversationId: conv.id, code: claudeStatus().state === 'not_installed' ? 'not_installed' : 'unavailable', message: msg });
    running.delete(conv.id);
    return { conversationId: conv.id };
  }

  void (async () => {
    let text = '';
    const result = await run({
      conversationId: conv.id,
      prompt: promptWithAttachments(opts.text, atts),
      mode: 'chat',
      sessionId: conv.claudeSessionId,
      signal: ac.signal,
      onEvent: (e) => {
        if (e.type === 'delta') {
          text += e.text;
          send({ type: 'delta', conversationId: conv.id, text: e.text });
        } else if (e.type === 'tool') {
          // Texto antes de uma ferramenta é narração intermediária: a resposta final vem depois.
          text = '';
          send({ type: 'tool', conversationId: conv.id, name: e.name.replace(/^mcp__pipo__/, '') });
        }
      },
    });
    running.delete(conv.id);
    if (result.type === 'done') {
      const finalText = text || result.text;
      if (result.sessionId) setConversationSession(conv.id, result.sessionId);
      if (finalText.trim()) addMessage(conv.id, 'assistant', finalText.trim());
      send({ type: 'done', conversationId: conv.id, text: finalText });
    } else {
      if (ac.signal.aborted) return;
      send({ type: 'error', conversationId: conv.id, code: result.code, message: result.message });
    }
  })();
  return { conversationId: conv.id };
}

/**
 * Captura rápida (seção 9.7): o agente extrai tarefa, data, cliente e estimativa e cria direto.
 * Sem o Claude, cria com o parser local.
 */
export async function captureToTask(text: string, source: 'manual' | 'voice' | 'clipboard'): Promise<Task | null> {
  const fallback = (): Task => {
    const p = parseCapture(text, listClients());
    const t = createTask({ title: p.title, dueAt: p.dueAt, estimateMin: p.estimateMin, clientId: p.clientId, priority: p.priority, source, isToday: !p.dueAt || undefined });
    tasksChanged();
    emit('toast:show', { id: `task:${t.id}`, text: `Anotado: ${t.title}`, undoable: true, durationMs: 5000 });
    return t;
  };
  if (!agentAvailable()) return fallback();
  const before = new Set(listTasks('open').map((t) => t.id));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  const result = await run({ conversationId: null, prompt: text, mode: 'capture', sessionId: null, signal: ac.signal, onEvent: () => undefined });
  clearTimeout(timer);
  const created = listTasks('open').filter((t) => !before.has(t.id));
  if (result.type === 'done' && created.length) return created[created.length - 1];
  return fallback();
}

/** Ao iniciar foco numa tarefa sem passos, o agente propõe de 3 a 5 (card de ação, seção 9.3). */
export async function proposeSubtasks(task: Task): Promise<void> {
  if (!agentAvailable()) return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4 * 60_000);
  await run({
    conversationId: null,
    prompt: `Proponha de 3 a 5 subtarefas curtas e concretas para a tarefa #${task.id} "${task.title}"${task.notes ? ` (notas: ${task.notes})` : ''} e chame add_subtasks uma única vez. Não escreva mais nada.`,
    mode: 'chat',
    sessionId: null,
    signal: ac.signal,
    onEvent: () => undefined,
  });
  clearTimeout(timer);
}

export function registerAgentIpc(): void {
  handle('agent:send', (opts) => sendMessage(opts));
  handle('agent:cancel', (id) => {
    running.get(id)?.abort();
    running.delete(id);
  });
  handle('agent:conversations', () => listConversations());
  handle('agent:messages', (id) => listMessages(id));
  handle('agent:newConversation', () => createConversation());
  handle('agent:getProvider', () => providerSetting());
  handle('agent:setProvider', ({ provider: p, apiKey }) => {
    if (apiKey !== undefined) setSecret('anthropicApiKey', apiKey || null);
    setKV('agentProvider', p);
  });
}
