// Passo `decide`: escolher uma entre opções fixas (classificar, rotear, sim/não, que link abrir).
// Quem decide é o Claude, e cada decisão vira um exemplo daquela ATIVIDADE. Um modelo local só
// entra numa atividade depois de treinado com os exemplos dela e de passar na prova: nunca um
// modelo cru, nunca o treino de outra atividade. Há dois modelos locais possíveis:
// - o do próprio Pipo ("pipo"): treina dentro do app, na CPU, sem instalar nada;
// - o Laya ("laya"): pede Python e placa de vídeo, fica para quem tiver. Funções puras aqui.

/** Quem deu a resposta. `usuario` são exemplos importados (já com a resposta certa). */
export type DecideSource = 'claude' | 'laya' | 'pipo' | 'usuario';

export interface DecideResult {
  escolha: string;
  /** 0–1. Do Claude não vem número: fica null. */
  confianca: number | null;
  origem: DecideSource;
}

/** Uma decisão registrada. `corrected` é a escolha certa quando o usuário corrigiu. */
export interface DecisionExample {
  id: number;
  activity: string;
  state: string;
  question: string;
  options: Record<string, string>;
  choice: string;
  confidence: number | null;
  source: DecideSource;
  corrected: string | null;
  createdAt: string;
}

/** Modelo local ligado a UMA atividade (o servidor `laya-serve` com o ajuste fino dela). */
export interface LocalModelConfig {
  /** Endereço do servidor na própria máquina (ex.: http://127.0.0.1:8000). */
  url: string;
  /** Campo `task` do servidor, se o ajuste fino foi registrado com um nome. */
  task?: string;
  /** Abaixo disso, a decisão volta para o Claude. */
  minConfidence: number;
}

/** Modelo local do próprio Pipo numa atividade. */
export interface OwnModelInfo {
  enabled: boolean;
  /** Acerto na prova, entre as decisões que ele responde sozinho. */
  accuracy: number;
  /** Fração das decisões que ele responde sozinho (o resto vai para o Claude). */
  coverage: number;
  threshold: number;
  trainedOn: number;
  trainedAt: string;
  /** Por que parou de responder (o acerto caiu, as opções mudaram), ou null. */
  paused: string | null;
}

export interface OwnReport {
  ok: boolean;
  total: number;
  accuracy: number;
  coverage: number;
  threshold: number;
  error: string | null;
}

/**
 * Regras do modelo do Pipo: quantos exemplos a atividade precisa, quanto ele tem de acertar na
 * prova (com exemplos que ficaram fora do treino) e de quantos em quantos exemplos novos treina de novo.
 */
export const OWN = { minExamples: 24, minPerLabel: 3, target: 0.92, minCoverage: 0.3, retrainEvery: 5, maxTrain: 600 } as const;

export interface ActivityInfo {
  activity: string;
  examples: number;
  /** Exemplos que servem de gabarito (decididos pelo Claude, importados ou corrigidos pelo usuário). */
  teacher: number;
  /** As opções são sempre as mesmas? (Lista que muda a cada decisão não dá para treinar.) */
  fixedOptions: boolean;
  own: OwnModelInfo | null;
  local: (LocalModelConfig & { agreement: number; checkedAt: string }) | null;
}

export interface CheckResult {
  ok: boolean;
  total: number;
  agree: number;
  /** Fração de exemplos em que o modelo local escolheu o mesmo que o gabarito. */
  rate: number;
  avgMs: number;
  error: string | null;
}

/** Para ligar o modelo local numa atividade: quantos exemplos ela precisa ter e quanto ele tem de acertar. */
export const CHECK = { minExamples: 20, sample: 40, minRate: 0.9 } as const;
export const QUESTION_KEY = 'decisao';
export const ACTIVITY_NAME = /^[a-z][a-z0-9_]{1,39}$/;

/** Opções do plano → {id: descrição}. Aceita objeto, lista de textos ou lista de {id, descricao}. */
export function normalizeOptions(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const id = String(o.id ?? o.nome ?? o.titulo ?? o.title ?? '').trim();
        if (id) out[id] = String(o.descricao ?? o.description ?? o.texto ?? id).trim();
      } else if (String(item ?? '').trim()) out[String(item).trim()] = String(item).trim();
    }
  } else if (v && typeof v === 'object') {
    for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (k.trim()) out[k.trim()] = String(d ?? k).trim() || k.trim();
  }
  return out;
}

/** Só servidor na própria máquina: o que está sendo decidido não sai dela. */
export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Corpo do pedido ao `laya-serve` (POST /v1/systemone). */
export function layaRequest(state: string, question: string, options: Record<string, string>, cfg: Pick<LocalModelConfig, 'task'>): Record<string, unknown> {
  return { state, questions: { [QUESTION_KEY]: { type: 'choice', instructions: question, criteria: options } }, ...(cfg.task ? { task: cfg.task } : {}) };
}

/** Resposta do `laya-serve` → escolha e confiança. null se a resposta não serve (opção desconhecida, formato estranho). */
export function parseLayaAnswer(json: unknown, options: Record<string, string>): { choice: string; confidence: number } | null {
  const a = (json as { answers?: Record<string, { choice?: unknown; answer_confidence?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> }> })?.answers?.[QUESTION_KEY];
  const choice = typeof a?.choice === 'string' ? a.choice : null;
  if (!choice || !(choice in options)) return null;
  const raw = [a?.answer_confidence, a?.probabilities?.[choice], a?.confidence].find((x) => typeof x === 'number' && Number.isFinite(x)) as number | undefined;
  return { choice, confidence: Math.max(0, Math.min(1, raw ?? 0)) };
}

/** A resposta do Claude ("orcamento", {"escolha":"orcamento"}, com crases…) → id de uma opção, ou null. */
export function parseChoice(text: string, options: Record<string, string>): string | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown = t;
  try {
    const j = JSON.parse(t) as unknown;
    value = j && typeof j === 'object' ? ((j as Record<string, unknown>).escolha ?? (j as Record<string, unknown>).choice) : j;
  } catch {
    const m = /"(?:escolha|choice)"\s*:\s*"([^"]+)"/.exec(t);
    if (m) value = m[1];
  }
  const want = String(value ?? '').trim().replace(/^["']|["']$/g, '');
  if (want in options) return want;
  const lower = want.toLowerCase();
  return Object.keys(options).find((k) => k.toLowerCase() === lower) ?? null;
}

/** O gabarito de um exemplo: a correção do usuário, a escolha do Claude ou um exemplo importado. A resposta de um modelo local não ensina nada. */
export function teacherChoice(e: Pick<DecisionExample, 'choice' | 'source' | 'corrected'>): string | null {
  return e.corrected ?? (e.source === 'claude' || e.source === 'usuario' ? e.choice : null);
}

/** Uma linha do arquivo de treino do Laya (`laya-train --data exemplos.jsonl`). null se o exemplo não tem gabarito. */
export function trainingLine(e: DecisionExample): string | null {
  const gold = teacherChoice(e);
  if (!gold || !(gold in e.options)) return null;
  return JSON.stringify({ state: e.state, questions: { [QUESTION_KEY]: { type: 'choice', instructions: e.question, criteria: e.options } }, expected: { [QUESTION_KEY]: gold } });
}

export function checkPasses(c: Pick<CheckResult, 'total' | 'rate' | 'error'>): boolean {
  return !c.error && c.total >= CHECK.minExamples && c.rate >= CHECK.minRate;
}
