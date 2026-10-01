// Abstração de provedor do agente (seção 3.3).
import type { AgentEffort, AgentModel } from '@shared/types';

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  /** Modelo que está respondendo (do `system/init` e de cada mensagem). */
  | { type: 'model'; model: string }
  | { type: 'done'; text: string; sessionId: string | null }
  | { type: 'error'; code: 'not_installed' | 'not_logged' | 'rate_limited' | 'failed'; message: string };

export interface SendOptions {
  /** Mensagem do usuário (o histórico fica na sessão do provedor). */
  prompt: string;
  systemPrompt: string;
  /** Sessão anterior para continuar a conversa (--resume). */
  sessionId: string | null;
  /** Id do contexto MCP desta chamada. */
  mcpContext: string;
  /** Pastas extras que o agente pode ler (anexos). */
  readDirs: string[];
  signal: AbortSignal;
  model: AgentModel;
  effort: AgentEffort;
  /** 'none': sem as ferramentas do Pipo (passos `agent` dos Pipos coloridos: só leem arquivos). */
  tools?: 'pipo' | 'none';
}

export interface AgentProvider {
  readonly id: 'claude-code' | 'anthropic-api';
  send(opts: SendOptions): AsyncIterable<ProviderEvent>;
}
