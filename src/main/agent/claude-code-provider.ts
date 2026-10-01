// Provedor padrão: Claude Code instalado e logado com a assinatura do usuário (seção 3.1). Sem chave de API.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelArgs } from '@shared/models';
import type { AgentEffort, AgentModel } from '@shared/types';
import { mcpConfigPath } from '../mcp/server';
import { paths } from '../paths';
import { claudeEnv, findClaude, spawnClaude } from './claude-bin';
import type { AgentProvider, ProviderEvent, SendOptions } from './provider';

/** Ferramentas embutidas bloqueadas: o agente só usa as ferramentas do Pipo e lê anexos. */
const DISALLOWED = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Glob', 'Grep', 'PowerShell'];

export function buildArgs(opts: { systemPromptFile: string; sessionId: string | null; readDirs: string[]; mcpConfig: string; model?: AgentModel; effort?: AgentEffort }): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    opts.systemPromptFile,
    '--mcp-config',
    opts.mcpConfig,
    '--strict-mcp-config',
    '--tools',
    'Read',
    '--allowedTools',
    'mcp__pipo__*',
    '--disallowedTools',
    DISALLOWED.join(','),
    '--permission-mode',
    'dontAsk',
  ];
  args.push(...modelArgs(opts.model ?? 'default', opts.effort ?? 'medium'));
  for (const d of opts.readDirs) args.push('--add-dir', d);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  return args;
}

const RATE = /(usage limit|rate limit|limite de uso|too many requests|overloaded|529|quota)/i;
const AUTH = /(not logged in|please run \/login|invalid api key|authenticat|unauthori[sz]ed|oauth token|credential)/i;

export function classifyError(text: string): ProviderEvent & { type: 'error' } {
  if (AUTH.test(text)) return { type: 'error', code: 'not_logged', message: text.slice(0, 300) };
  if (RATE.test(text)) return { type: 'error', code: 'rate_limited', message: text.slice(0, 300) };
  return { type: 'error', code: 'failed', message: text.slice(0, 300) || 'Falha ao falar com o Claude.' };
}

interface StreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  is_error?: boolean;
  result?: string;
  event?: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; name?: string } };
  message?: { model?: string; content?: Array<{ type: string; name?: string; text?: string }> };
}

/** Converte uma linha NDJSON do `stream-json` em eventos do Pipo. Exportado para testes. */
export function parseStreamLine(line: string): ProviderEvent[] {
  let j: StreamLine;
  try {
    j = JSON.parse(line) as StreamLine;
  } catch {
    return [];
  }
  if (j.type === 'stream_event' && j.event) {
    if (j.event.type === 'content_block_delta' && j.event.delta?.type === 'text_delta' && j.event.delta.text) return [{ type: 'delta', text: j.event.delta.text }];
    if (j.event.type === 'content_block_start' && j.event.content_block?.type === 'tool_use' && j.event.content_block.name) return [{ type: 'tool', name: j.event.content_block.name }];
    return [];
  }
  if (j.type === 'system' && j.subtype === 'init' && j.model) return [{ type: 'model', model: j.model }];
  // Cada mensagem traz o modelo que de fato respondeu (inclusive depois de um fallback).
  if (j.type === 'assistant' && j.message?.model) return [{ type: 'model', model: j.message.model }];
  if (j.type === 'result') {
    if (j.is_error || (j.subtype && j.subtype !== 'success')) return [classifyError(j.result ?? j.subtype ?? '')];
    return [{ type: 'done', text: j.result ?? '', sessionId: j.session_id ?? null }];
  }
  return [];
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code' as const;

  async *send(opts: SendOptions): AsyncIterable<ProviderEvent> {
    const bin = findClaude();
    if (!bin) {
      yield { type: 'error', code: 'not_installed', message: 'Claude Code não encontrado.' };
      return;
    }
    const spFile = join(paths.workspace, `.system-prompt-${opts.mcpContext}.md`);
    writeFileSync(spFile, opts.systemPrompt);
    const args = buildArgs({ systemPromptFile: spFile, sessionId: opts.sessionId, readDirs: opts.readDirs, mcpConfig: mcpConfigPath(), model: opts.model, effort: opts.effort });
    // O shim MCP herda esta variável e informa ao app de qual conversa veio a chamada.
    const env: NodeJS.ProcessEnv = { ...claudeEnv(), PIPO_MCP_CONTEXT: opts.mcpContext };

    const child = spawnClaude(bin, args, { cwd: paths.workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const queue: ProviderEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let gotResult = false;
    let stderr = '';
    let buf = '';
    const push = (e: ProviderEvent): void => {
      if (e.type === 'done' || e.type === 'error') gotResult = true;
      queue.push(e);
      wake?.();
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) for (const e of parseStreamLine(line)) push(e);
      }
    });
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      push({ type: 'error', code: 'not_installed', message: String(e) });
      finished = true;
      wake?.();
    });
    child.on('close', (code) => {
      if (buf.trim()) for (const e of parseStreamLine(buf.trim())) push(e);
      if (!gotResult) push(code === 0 ? { type: 'done', text: '', sessionId: opts.sessionId } : classifyError(stderr || `código ${code}`));
      finished = true;
      wake?.();
    });
    opts.signal.addEventListener('abort', () => child.kill());
    child.stdin?.end(opts.prompt);

    while (!finished || queue.length) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) yield queue.shift() as ProviderEvent;
    }
  }
}
