// Modelos do agente (seção 1 do plano V2). Aliases do Claude Code; o provedor por API usa os ids.
import type { AgentEffort, AgentModel } from './types';

export const DEFAULT_AGENT = { model: 'sonnet' as AgentModel, effort: 'medium' as AgentEffort };

/** Ids da API para o provedor por chave. */
export const API_MODEL_IDS: Record<Exclude<AgentModel, 'default'>, string> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-4-5-20251001',
};

/** Para onde cair se o modelo escolhido estiver sobrecarregado/indisponível. */
const FALLBACKS: Record<Exclude<AgentModel, 'default'>, string[]> = {
  sonnet: ['haiku'],
  opus: ['sonnet', 'haiku'],
  haiku: ['sonnet'],
};

/** Argumentos do `claude -p` para modelo/effort. "default" não passa nada (vale o do terminal). */
export function modelArgs(model: AgentModel, effort: AgentEffort): string[] {
  if (model === 'default') return [];
  const args = ['--model', model, '--fallback-model', FALLBACKS[model].join(',')];
  // O Haiku não tem níveis de effort.
  if (model !== 'haiku') args.push('--effort', effort);
  return args;
}

/** "claude-sonnet-5-5" → "Sonnet 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function prettyModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?![\d])/i.exec(id);
  if (!m) return id;
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}
