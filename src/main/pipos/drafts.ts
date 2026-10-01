// Rascunhos do /criarpipo e do /editarpipo: a conversa vai preenchendo personalidade, plano e gatilhos.
import { EMPTY_PLAYBOOK, type EventSpec, type PipoPlaybook } from '@shared/pipos';
import { db } from '../db';

export type DraftStage = 'start' | 'personality' | 'interview' | 'connections' | 'plan' | 'rehearsal' | 'hire';
export const STAGES: DraftStage[] = ['start', 'personality', 'interview', 'connections', 'plan', 'rehearsal', 'hire'];

export interface DraftTriggers {
  /** Agenda em linguagem natural ("seg–sex 9h"), ou null. */
  schedule: string | null;
  /** Roda depois de outro Pipo. */
  after: { from: string; delayMin: number } | null;
  events: EventSpec[];
}

export interface DraftData {
  pipoId: number | null;
  /** Editando um Pipo já contratado (/editarpipo): ao contratar vira nova versão. */
  editing: boolean;
  plan: PipoPlaybook;
  triggers: DraftTriggers;
  /** Respostas do roteiro: item → resposta curta (ou "não se aplica"). */
  interview: Record<string, string>;
  /** Último ensaio (id da execução em modo seco) e se passou. */
  rehearsal: { runId: number; ok: boolean } | null;
}

export interface Draft {
  id: number;
  stage: DraftStage;
  conversationId: number | null;
  data: DraftData;
  updatedAt: string;
  fromModelId: number | null;
}

interface Row {
  id: number;
  stage: DraftStage;
  conversation_id: number | null;
  draft_json: string;
  updated_at: string;
  from_model_id: number | null;
}

export const EMPTY_DRAFT: DraftData = {
  pipoId: null,
  editing: false,
  plan: EMPTY_PLAYBOOK,
  triggers: { schedule: null, after: null, events: [] },
  interview: {},
  rehearsal: null,
};

const toDraft = (r: Row): Draft => ({
  id: r.id,
  stage: r.stage,
  conversationId: r.conversation_id,
  data: { ...EMPTY_DRAFT, ...(JSON.parse(r.draft_json) as Partial<DraftData>) },
  updatedAt: r.updated_at,
  fromModelId: r.from_model_id,
});

export function createDraft(conversationId: number | null, data: Partial<DraftData> = {}, fromModelId: number | null = null): Draft {
  const { lastId } = db().run(
    'INSERT INTO pipo_drafts (from_model_id, stage, conversation_id, draft_json, pipo_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    fromModelId,
    'start',
    conversationId,
    JSON.stringify({ ...EMPTY_DRAFT, ...data }),
    data.pipoId ?? null,
    new Date().toISOString(),
  );
  return getDraft(lastId) as Draft;
}

export function getDraft(id: number): Draft | null {
  const r = db().get<Row>('SELECT * FROM pipo_drafts WHERE id = ?', id);
  return r ? toDraft(r) : null;
}

export function draftForConversation(conversationId: number): Draft | null {
  const r = db().get<Row>('SELECT * FROM pipo_drafts WHERE conversation_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', conversationId);
  return r ? toDraft(r) : null;
}

/** Rascunhos abertos (o mais recente primeiro). */
export function openDrafts(): Draft[] {
  return db().all<Row>('SELECT * FROM pipo_drafts WHERE closed_at IS NULL ORDER BY updated_at DESC').map(toDraft);
}

export function updateDraft(id: number, patch: { stage?: DraftStage; data?: Partial<DraftData>; conversationId?: number }): Draft {
  const cur = getDraft(id);
  if (!cur) throw new Error('Rascunho não encontrado.');
  const data = { ...cur.data, ...(patch.data ?? {}) };
  db().run(
    'UPDATE pipo_drafts SET stage = ?, draft_json = ?, pipo_id = ?, conversation_id = ?, updated_at = ? WHERE id = ?',
    patch.stage ?? cur.stage,
    JSON.stringify(data),
    data.pipoId,
    patch.conversationId ?? cur.conversationId,
    new Date().toISOString(),
    id,
  );
  return getDraft(id) as Draft;
}

export function closeDraft(id: number): void {
  db().run('UPDATE pipo_drafts SET closed_at = ? WHERE id = ?', new Date().toISOString(), id);
}

/** Pipos com rascunho aberto e ainda sem plano contratado aparecem tracejados na pill. */
export function draftPipoIds(): number[] {
  return openDrafts()
    .map((d) => d.data.pipoId)
    .filter((x): x is number => typeof x === 'number');
}
