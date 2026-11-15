// Pipo que se aprimora (método adaptado do Harness², Google Research, Apache 2.0): depois de uma
// execução real, propõe duas versões do plano (uma geral e uma do assunto), ensaia as duas, junta só o
// que teve evidência e sugere ao usuário. Aqui ficam os tipos e as regras puras (testadas).
import type { PipoPlaybook, RunStatus } from './pipos';

export interface ImproveChange {
  /** O que muda, em uma frase. */
  mudanca: string;
  /** Por que muda. */
  porque: string;
  /** O momento da execução que justifica (passo e o que aconteceu). */
  evidencia: string;
}

export type ImproveStatus = 'working' | 'pending' | 'applied' | 'rejected' | 'kept' | 'failed';

export interface PipoImprovement {
  id: number;
  pipoId: number;
  baseVersion: number;
  runId: number | null;
  status: ImproveStatus;
  changes: ImproveChange[];
  rules: string[];
  /** Por que manteve ou falhou, ou um resumo. */
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type Confidence = 'alta' | 'media' | 'baixa';

export interface PipoLesson {
  id: number;
  pipoId: number | null;
  /** Em que situação vale. */
  cue: string;
  lesson: string;
  evidence: string;
  confidence: Confidence;
  createdAt: string;
}

/** O que um proponente devolve. */
export interface Candidate {
  manter: boolean;
  motivo?: string;
  plano?: PipoPlaybook;
  regras: string[];
  mudancas: ImproveChange[];
}

/** O que o compositor devolve. */
export interface Composition {
  decisao: 'juntar' | 'geral' | 'assunto' | 'manter';
  plano?: PipoPlaybook;
  regras: string[];
  mudancas: ImproveChange[];
  efeitos: Array<{ mudanca: string; veredito: 'ajudou' | 'atrapalhou' | 'sem efeito' | 'inconclusivo'; observado: string }>;
  licao: { situacao: string; licao: string; evidencia: string; confianca: Confidence } | null;
  motivo?: string;
}

/** Vale a pena estudar este Pipo agora? Só com motivo e no máximo uma vez a cada 20 horas. */
export function shouldImprove(i: { lastStatus: RunStatus; refused: boolean; skipped: number; newRules: number; runsSinceAttempt: number; hoursSinceAttempt: number | null; pending: boolean }): boolean {
  if (i.pending) return false;
  if (i.hoursSinceAttempt !== null && i.hoursSinceAttempt < 20) return false;
  return i.lastStatus === 'failed' || i.refused || i.skipped > 0 || i.newRules > 0 || i.runsSinceAttempt >= 5;
}

/** Primeiro objeto JSON do texto (o modelo às vezes embrulha em ```json). */
export function firstJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (!m) throw new Error('A resposta não trouxe JSON.');
    return JSON.parse(m[0]);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function changes(v: unknown): ImproveChange[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ mudanca: str(c.mudanca), porque: str(c.porque), evidencia: str(c.evidencia) }))
    .filter((c) => c.mudanca);
}

function rules(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 5) : [];
}

function plan(v: unknown): PipoPlaybook | undefined {
  if (!v || typeof v !== 'object' || !Array.isArray((v as { steps?: unknown }).steps)) return undefined;
  const p = v as PipoPlaybook;
  return { ...p, metrics: Array.isArray(p.metrics) ? p.metrics : [], limits: p.limits ?? { maxRunMinutes: 15, window: null } };
}

export function parseCandidate(text: string): Candidate {
  const o = firstJson(text) as Record<string, unknown>;
  if (o.manter === true) return { manter: true, motivo: str(o.motivo) || undefined, regras: [], mudancas: [] };
  const p = plan(o.plano);
  if (!p) throw new Error('Faltou o plano completo em "plano" (com "steps").');
  const m = changes(o.mudancas);
  if (!m.length) throw new Error('Cada mudança precisa vir em "mudancas", com a evidência.');
  if (m.some((c) => !c.evidencia)) throw new Error('Toda mudança precisa de "evidencia": o passo e o que aconteceu.');
  return { manter: false, plano: p, regras: rules(o.regras), mudancas: m };
}

const VEREDITOS = ['ajudou', 'atrapalhou', 'sem efeito', 'inconclusivo'] as const;
const CONFIANCAS: Confidence[] = ['alta', 'media', 'baixa'];

export function parseComposition(text: string): Composition {
  const o = firstJson(text) as Record<string, unknown>;
  const decisao = (['juntar', 'geral', 'assunto', 'manter'] as const).find((d) => d === o.decisao);
  if (!decisao) throw new Error('"decisao" precisa ser juntar, geral, assunto ou manter.');
  const efeitos = Array.isArray(o.efeitos)
    ? (o.efeitos as Array<Record<string, unknown>>).map((e) => ({ mudanca: str(e?.mudanca), veredito: VEREDITOS.find((v) => v === e?.veredito) ?? 'inconclusivo', observado: str(e?.observado) })).filter((e) => e.mudanca)
    : [];
  const l = o.licao && typeof o.licao === 'object' ? (o.licao as Record<string, unknown>) : null;
  const licao = l && str(l.licao) && str(l.evidencia) ? { situacao: str(l.situacao), licao: str(l.licao), evidencia: str(l.evidencia), confianca: CONFIANCAS.find((c) => c === l.confianca) ?? 'baixa' } : null;
  if (decisao === 'manter') return { decisao, regras: [], mudancas: [], efeitos, licao, motivo: str(o.motivo) || undefined };
  const p = plan(o.plano);
  if (!p) throw new Error('Faltou o plano final em "plano".');
  const m = changes(o.mudancas);
  if (!m.length) throw new Error('Faltou a lista de mudanças em "mudancas".');
  return { decisao, plano: p, regras: rules(o.regras), mudancas: m, efeitos, licao };
}
