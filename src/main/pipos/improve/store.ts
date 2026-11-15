// Sugestões de melhoria e a biblioteca de lições (tabelas da migração 010).
import type { Confidence, ImproveChange, ImproveStatus, PipoImprovement, PipoLesson } from '@shared/improve';
import type { PipoPlaybook } from '@shared/pipos';
import { db } from '../../db';

interface Row {
  id: number;
  pipo_id: number;
  base_version: number;
  run_id: number | null;
  status: ImproveStatus;
  playbook_json: string | null;
  changes_json: string;
  rules_json: string;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

const toImprovement = (r: Row): PipoImprovement => ({
  id: r.id,
  pipoId: r.pipo_id,
  baseVersion: r.base_version,
  runId: r.run_id,
  status: r.status,
  changes: JSON.parse(r.changes_json) as ImproveChange[],
  rules: JSON.parse(r.rules_json) as string[],
  note: r.note,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export function createImprovement(pipoId: number, baseVersion: number, runId: number | null): PipoImprovement {
  const { lastId } = db().run('INSERT INTO pipo_improvements (pipo_id, base_version, run_id, status, created_at) VALUES (?, ?, ?, ?, ?)', pipoId, baseVersion, runId, 'working', new Date().toISOString());
  return getImprovement(lastId) as PipoImprovement;
}

export function getImprovement(id: number): PipoImprovement | null {
  const r = db().get<Row>('SELECT * FROM pipo_improvements WHERE id = ?', id);
  return r ? toImprovement(r) : null;
}

/** O plano sugerido (só existe enquanto a sugestão está pendente ou depois de aplicada). */
export function improvementPlaybook(id: number): PipoPlaybook | null {
  const r = db().get<{ playbook_json: string | null }>('SELECT playbook_json FROM pipo_improvements WHERE id = ?', id);
  return r?.playbook_json ? (JSON.parse(r.playbook_json) as PipoPlaybook) : null;
}

export function finishImprovement(id: number, o: { status: ImproveStatus; playbook?: PipoPlaybook | null; changes?: ImproveChange[]; rules?: string[]; note?: string | null }): PipoImprovement {
  db().run(
    'UPDATE pipo_improvements SET status = ?, playbook_json = ?, changes_json = ?, rules_json = ?, note = ? WHERE id = ?',
    o.status,
    o.playbook ? JSON.stringify(o.playbook) : null,
    JSON.stringify(o.changes ?? []),
    JSON.stringify(o.rules ?? []),
    o.note ?? null,
    id,
  );
  return getImprovement(id) as PipoImprovement;
}

export function decideImprovementRow(id: number, status: 'applied' | 'rejected'): void {
  db().run('UPDATE pipo_improvements SET status = ?, decided_at = ? WHERE id = ?', status, new Date().toISOString(), id);
}

export function listImprovements(pipoId: number, limit = 10): PipoImprovement[] {
  return db().all<Row>('SELECT * FROM pipo_improvements WHERE pipo_id = ? ORDER BY id DESC LIMIT ?', pipoId, limit).map(toImprovement);
}

/** Estudos que ficaram "trabalhando" quando o app fechou viram falha (não ficam presos). */
export function closeOrphanImprovements(): void {
  db().run("UPDATE pipo_improvements SET status = 'failed', note = 'O app fechou no meio do estudo.' WHERE status = 'working'");
}

// ---------- Biblioteca de lições ----------

export function addLesson(l: { pipoId: number | null; cue: string; lesson: string; evidence: string; confidence: Confidence }): void {
  db().run('INSERT INTO pipo_lessons (pipo_id, cue, lesson, evidence, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)', l.pipoId, l.cue, l.lesson, l.evidence, l.confidence, new Date().toISOString());
}

export function listLessons(limit = 12): PipoLesson[] {
  return db()
    .all<{ id: number; pipo_id: number | null; cue: string; lesson: string; evidence: string; confidence: Confidence; created_at: string }>("SELECT * FROM pipo_lessons WHERE confidence != 'baixa' ORDER BY id DESC LIMIT ?", limit)
    .map((r) => ({ id: r.id, pipoId: r.pipo_id, cue: r.cue, lesson: r.lesson, evidence: r.evidence, confidence: r.confidence, createdAt: r.created_at }));
}

/** As lições em texto, para os prompts (construtor e estudos). */
export function lessonsText(limit = 12): string | null {
  const l = listLessons(limit);
  return l.length ? l.map((x) => `- Quando ${x.cue}: ${x.lesson} (evidência: ${x.evidence})`).join('\n') : null;
}
