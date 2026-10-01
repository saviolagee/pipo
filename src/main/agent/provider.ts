// Abstração de provedor do agente (seção 3.3).

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
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
}

export interface AgentProvider {
  readonly id: 'claude-code' | 'anthropic-api';
  send(opts: SendOptions): AsyncIterable<ProviderEvent>;
}
