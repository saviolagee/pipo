// Provedor alternativo por chave de API (desativado por padrão; seção 3.3). Usa o SDK oficial e as
// mesmas ferramentas do Pipo, sem passar pelo MCP.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaTool, BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { API_MODEL_IDS } from '@shared/models';
import { callTool, toolDescriptors, type ToolCtx } from '../mcp/tools';
import { paths } from '../paths';
import type { AgentProvider, ProviderEvent, SendOptions } from './provider';

/** Modelo padrão do provedor por chave (seção 1 do plano V2). */
export const API_MODEL = API_MODEL_IDS.sonnet;
const MAX_TOOL_ROUNDS = 12;

/** Histórico por sessão (a API é sem estado). Mantido em memória enquanto o app está aberto. */
const sessions = new Map<string, BetaMessageParam[]>();

function readAttachment(path: string): string {
  const full = resolve(path);
  if (!full.startsWith(resolve(paths.files) + sep)) return 'Acesso negado: só arquivos anexados podem ser lidos.';
  if (!/\.(txt|md|csv|json)$/i.test(full)) return 'Este provedor só lê anexos de texto; PDFs e imagens precisam do Claude Code.';
  return readFileSync(full, 'utf8').slice(0, 200_000);
}

export class AnthropicApiProvider implements AgentProvider {
  readonly id = 'anthropic-api' as const;
  constructor(
    private apiKey: string,
    private ctxFor: (mcpContext: string) => ToolCtx,
  ) {}

  async *send(opts: SendOptions): AsyncIterable<ProviderEvent> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const sessionId = opts.sessionId && sessions.has(opts.sessionId) ? opts.sessionId : randomUUID();
    const history = sessions.get(sessionId) ?? [];
    history.push({ role: 'user', content: opts.prompt });
    const tools: BetaToolUnion[] = [
      ...toolDescriptors().map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as BetaTool['input_schema'], eager_input_streaming: true })),
      {
        name: 'read_attachment',
        description: 'Lê um arquivo anexado (texto) pelo caminho absoluto.',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        eager_input_streaming: true,
      },
    ] as BetaToolUnion[];
    const ctx = this.ctxFor(opts.mcpContext);
    let finalText = '';
    const model = opts.model === 'default' ? API_MODEL : API_MODEL_IDS[opts.model];
    // O Haiku não aceita effort.
    const effort = opts.model === 'haiku' ? undefined : { effort: opts.effort };
    yield { type: 'model', model };

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 16000,
            system: opts.systemPrompt,
            messages: history,
            tools,
            ...(effort ? { output_config: effort } : {}),
            // Recusas de segurança caem automaticamente num modelo de reserva.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: opts.signal },
        );
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            finalText += ev.delta.text;
            yield { type: 'delta', text: ev.delta.text };
          } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
            yield { type: 'tool', name: ev.content_block.name };
          }
        }
        const msg = await stream.finalMessage();
        // Conteúdo completo de volta no histórico (blocos de thinking incluídos, sem edição).
        history.push({ role: 'assistant', content: msg.content });
        if (msg.stop_reason === 'refusal') {
          yield { type: 'error', code: 'failed', message: 'O Claude recusou este pedido.' };
          return;
        }
        if (msg.stop_reason !== 'tool_use') break;

        const results: BetaToolResultBlockParam[] = [];
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          const input = block.input;
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'INVALID_JSON: argumentos inválidos.', is_error: true });
            continue;
          }
          if (block.name === 'read_attachment') {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: readAttachment(String((input as { path?: unknown }).path ?? '')) });
            continue;
          }
          const r = await callTool(block.name, input as Record<string, unknown>, ctx);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: r.text, is_error: r.isError });
        }
        history.push({ role: 'user', content: results });
      }
      sessions.set(sessionId, history);
      yield { type: 'done', text: finalText, sessionId };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) yield { type: 'error', code: 'not_logged', message: 'Chave de API inválida.' };
      else if (e instanceof Anthropic.RateLimitError) yield { type: 'error', code: 'rate_limited', message: 'Limite de uso da API atingido.' };
      else if (e instanceof Anthropic.APIError) yield { type: 'error', code: 'failed', message: `Erro da API (${e.status ?? '?'}): ${e.message}` };
      else yield { type: 'error', code: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
  }
}
