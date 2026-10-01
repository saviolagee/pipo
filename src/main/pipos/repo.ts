// Repositório dos Pipos coloridos: identidade, versões do plano, gatilhos, execuções, memória e permissões.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_PLAYBOOK,
  slugify,
  type MetricDef,
  type Pipo,
  type PipoAccessory,
  type PipoColor,
  type PipoMemoryRule,
  type PipoPersonality,
  type PipoPlaybook,
  type PipoRun,
  type PipoRunStep,
  type PipoStep,
  type PipoTrigger,
  type PipoVersion,
  type RunStatus,
  type StepStatus,
  type TriggerKind,
} from '@shared/pipos';
import type { AgentEffort, AgentModel } from '@shared/types';
import { db } from '../db';
import { paths } from '../paths';

interface PipoRow {
  id: number;
  slug: string;
  name: string;
  color: PipoColor;
  accessory: PipoAccessory;
  personality_json: string;
  model: AgentModel;
  effort: AgentEffort;
  paused: number;
  run_on_days_off: number;
  active_version: number | null;
  created_at: string;
}

const toPipo = (r: PipoRow): Pipo => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  color: r.color,
  accessory: r.accessory,
  personality: JSON.parse(r.personality_json) as PipoPersonality,
  model: r.model,
  effort: r.effort,
  paused: !!r.paused,
  runOnDaysOff: !!r.run_on_days_off,
  activeVersion: r.active_version,
  createdAt: r.created_at,
});

/** O cofre de segredos é indexado pelo @nome: quando ele muda, os segredos mudam junto. */
export const repoHooks: { slugChanged: (from: string, to: string) => void } = { slugChanged: () => undefined };

// ---------- Pastas ----------

export function pipoDir(slug: string): string {
  return join(paths.userData, 'pipos', slug);
}

export function ensurePipoDirs(slug: string): string {
  const dir = pipoDir(slug);
  for (const sub of ['scripts', 'templates', 'runs', 'inbox']) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

// ---------- Pipos ----------

export function listPipos(): Pipo[] {
  return db().all<PipoRow>('SELECT * FROM pipos WHERE deleted_at IS NULL ORDER BY id').map(toPipo);
}

export function getPipo(idOrSlug: number | string): Pipo | null {
  const r =
    typeof idOrSlug === 'number'
      ? db().get<PipoRow>('SELECT * FROM pipos WHERE id = ? AND deleted_at IS NULL', idOrSlug)
      : db().get<PipoRow>('SELECT * FROM pipos WHERE slug = ? AND deleted_at IS NULL', idOrSlug.replace(/^@/, '').toLowerCase());
  return r ? toPipo(r) : null;
}

function uniqueSlug(name: string, ignoreId?: number): string {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const r = db().get<{ id: number }>('SELECT id FROM pipos WHERE slug = ?', slug);
    if (!r || r.id === ignoreId) return slug;
    slug = `${base}-${i}`;
  }
}

export interface NewPipo {
  name: string;
  color: PipoColor;
  accessory?: PipoAccessory;
  personality: PipoPersonality;
  model?: AgentModel;
  effort?: AgentEffort;
  runOnDaysOff?: boolean;
}

export function createPipo(p: NewPipo): Pipo {
  const slug = uniqueSlug(p.name);
  const { lastId } = db().run(
    'INSERT INTO pipos (slug, name, color, accessory, personality_json, model, effort, run_on_days_off, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    slug,
    p.name.trim(),
    p.color,
    p.accessory ?? 'none',
    JSON.stringify(p.personality),
    p.model ?? 'sonnet',
    p.effort ?? 'medium',
    p.runOnDaysOff ?? false,
    new Date().toISOString(),
  );
  ensurePipoDirs(slug);
  return getPipo(lastId) as Pipo;
}

export type PipoPatch = Partial<Pick<Pipo, 'name' | 'color' | 'accessory' | 'personality' | 'model' | 'effort' | 'paused' | 'runOnDaysOff'>>;

export function updatePipo(id: number, patch: PipoPatch): Pipo {
  const cur = getPipo(id);
  if (!cur) throw new Error('Pipo não encontrado.');
  const next = { ...cur, ...patch };
  // Ainda em rascunho (nunca contratado): o @nome acompanha o nome novo.
  if (patch.name && patch.name.trim() !== cur.name && !cur.activeVersion) {
    const slug = uniqueSlug(patch.name, id);
    if (slug !== cur.slug) {
      if (existsSync(pipoDir(cur.slug))) renameSync(pipoDir(cur.slug), pipoDir(slug));
      db().run('UPDATE pipos SET slug = ? WHERE id = ?', slug, id);
      repoHooks.slugChanged(cur.slug, slug);
    }
  }
  db().run(
    'UPDATE pipos SET name = ?, color = ?, accessory = ?, personality_json = ?, model = ?, effort = ?, paused = ?, run_on_days_off = ? WHERE id = ?',
    next.name.trim(),
    next.color,
    next.accessory,
    JSON.stringify(next.personality),
    next.model,
    next.effort,
    next.paused,
    next.runOnDaysOff,
    id,
  );
  return getPipo(id) as Pipo;
}

/** Apaga o Pipo e a pasta dele (scripts, execuções). Segredos são apagados por quem chama. */
export function deletePipo(id: number): void {
  const p = getPipo(id);
  if (!p) return;
  db().run('DELETE FROM pipos WHERE id = ?', id);
  rmSync(pipoDir(p.slug), { recursive: true, force: true });
}

// ---------- Versões do plano ----------

interface VersionRow {
  id: number;
  pipo_id: number;
  version: number;
  playbook_json: string;
  changelog: string;
  created_at: string;
  approved_at: string | null;
}

const toVersion = (r: VersionRow): PipoVersion => ({
  id: r.id,
  pipoId: r.pipo_id,
  version: r.version,
  playbook: { ...EMPTY_PLAYBOOK, ...(JSON.parse(r.playbook_json) as Partial<PipoPlaybook>) },
  changelog: r.changelog,
  createdAt: r.created_at,
  approvedAt: r.approved_at,
});

export function listVersions(pipoId: number): PipoVersion[] {
  return db().all<VersionRow>('SELECT * FROM pipo_versions WHERE pipo_id = ? ORDER BY version', pipoId).map(toVersion);
}

export function getVersion(pipoId: number, version: number): PipoVersion | null {
  const r = db().get<VersionRow>('SELECT * FROM pipo_versions WHERE pipo_id = ? AND version = ?', pipoId, version);
  return r ? toVersion(r) : null;
}

export function activePlaybook(pipoId: number): PipoVersion | null {
  const p = getPipo(pipoId);
  return p?.activeVersion ? getVersion(pipoId, p.activeVersion) : null;
}

/** Nova versão aprovada: vira a ativa. O plano fixado só muda por aqui (sempre com confirmação). */
export function addVersion(pipoId: number, playbook: PipoPlaybook, changelog: string, approved = true): PipoVersion {
  const next = (db().get<{ v: number | null }>('SELECT MAX(version) AS v FROM pipo_versions WHERE pipo_id = ?', pipoId)?.v ?? 0) + 1;
  const now = new Date().toISOString();
  db().run('INSERT INTO pipo_versions (pipo_id, version, playbook_json, changelog, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?)', pipoId, next, JSON.stringify(playbook), changelog, now, approved ? now : null);
  if (approved) db().run('UPDATE pipos SET active_version = ? WHERE id = ?', next, pipoId);
  return getVersion(pipoId, next) as PipoVersion;
}

// ---------- Gatilhos ----------

interface TriggerRow {
  id: number;
  pipo_id: number;
  kind: TriggerKind;
  spec_json: string;
  enabled: number;
  last_fired_at: string | null;
}

const toTrigger = (r: TriggerRow): PipoTrigger => ({ id: r.id, pipoId: r.pipo_id, kind: r.kind, spec: JSON.parse(r.spec_json) as PipoTrigger['spec'], enabled: !!r.enabled, lastFiredAt: r.last_fired_at });

export function listTriggers(pipoId?: number): PipoTrigger[] {
  const rows = pipoId === undefined ? db().all<TriggerRow>('SELECT * FROM pipo_triggers ORDER BY id') : db().all<TriggerRow>('SELECT * FROM pipo_triggers WHERE pipo_id = ? ORDER BY id', pipoId);
  return rows.map(toTrigger);
}

export function addTrigger(pipoId: number, kind: TriggerKind, spec: PipoTrigger['spec']): PipoTrigger {
  const { lastId } = db().run('INSERT INTO pipo_triggers (pipo_id, kind, spec_json) VALUES (?, ?, ?)', pipoId, kind, JSON.stringify(spec));
  return toTrigger(db().get<TriggerRow>('SELECT * FROM pipo_triggers WHERE id = ?', lastId) as TriggerRow);
}

export function updateTrigger(id: number, patch: { spec?: PipoTrigger['spec']; enabled?: boolean }): void {
  const r = db().get<TriggerRow>('SELECT * FROM pipo_triggers WHERE id = ?', id);
  if (!r) return;
  db().run('UPDATE pipo_triggers SET spec_json = ?, enabled = ? WHERE id = ?', patch.spec ? JSON.stringify(patch.spec) : r.spec_json, patch.enabled ?? !!r.enabled, id);
}

export function deleteTrigger(id: number): void {
  db().run('DELETE FROM pipo_triggers WHERE id = ?', id);
}

export function markTriggerFired(id: number, at = new Date()): void {
  db().run('UPDATE pipo_triggers SET last_fired_at = ? WHERE id = ?', at.toISOString(), id);
}

// ---------- Execuções ----------

interface RunRow {
  id: number;
  pipo_id: number;
  version: number;
  trigger: string;
  status: RunStatus;
  dry_run: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  metrics_json: string;
  from_run_id: number | null;
  error: string | null;
}

const toRun = (r: RunRow): PipoRun => ({
  id: r.id,
  pipoId: r.pipo_id,
  version: r.version,
  trigger: r.trigger,
  status: r.status,
  dryRun: !!r.dry_run,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  summary: r.summary,
  metrics: JSON.parse(r.metrics_json) as Record<string, number>,
  fromRunId: r.from_run_id,
  error: r.error,
});

export function createRun(pipoId: number, version: number, trigger: string, dryRun: boolean, fromRunId: number | null, steps: PipoStep[]): PipoRun {
  const { lastId } = db().run(
    'INSERT INTO pipo_runs (pipo_id, version, trigger, status, dry_run, started_at, from_run_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    pipoId,
    version,
    trigger,
    'running',
    dryRun,
    new Date().toISOString(),
    fromRunId,
  );
  for (const s of steps) db().run("INSERT INTO pipo_run_steps (run_id, step_key, title, kind, status) VALUES (?, ?, ?, ?, 'pending')", lastId, s.key, s.title, s.kind);
  return getRun(lastId) as PipoRun;
}

export function getRun(id: number): PipoRun | null {
  const r = db().get<RunRow>('SELECT * FROM pipo_runs WHERE id = ?', id);
  return r ? toRun(r) : null;
}

export function listRuns(pipoId: number | null, limit = 50, sinceIso?: string): PipoRun[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (pipoId !== null) {
    where.push('pipo_id = ?');
    params.push(pipoId);
  }
  if (sinceIso) {
    where.push('started_at >= ?');
    params.push(sinceIso);
  }
  return db()
    .all<RunRow>(`SELECT * FROM pipo_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, ...params, limit)
    .map(toRun);
}

export function lastRun(pipoId: number, includeDry = false): PipoRun | null {
  const r = db().get<RunRow>(`SELECT * FROM pipo_runs WHERE pipo_id = ? ${includeDry ? '' : 'AND dry_run = 0'} ORDER BY id DESC LIMIT 1`, pipoId);
  return r ? toRun(r) : null;
}

export function finishRun(id: number, status: RunStatus, opts: { summary?: string | null; metrics?: Record<string, number>; error?: string | null } = {}): PipoRun {
  db().run(
    'UPDATE pipo_runs SET status = ?, finished_at = ?, summary = COALESCE(?, summary), metrics_json = COALESCE(?, metrics_json), error = ? WHERE id = ?',
    status,
    status === 'running' || status === 'waiting' ? null : new Date().toISOString(),
    opts.summary ?? null,
    opts.metrics ? JSON.stringify(opts.metrics) : null,
    opts.error ?? null,
    id,
  );
  return getRun(id) as PipoRun;
}

export function setRunStatus(id: number, status: RunStatus): void {
  db().run('UPDATE pipo_runs SET status = ? WHERE id = ?', status, id);
}

interface RunStepRow {
  id: number;
  run_id: number;
  step_key: string;
  title: string;
  kind: PipoStep['kind'];
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  preview: string | null;
  error: string | null;
}

export function runSteps(runId: number): PipoRunStep[] {
  return db()
    .all<RunStepRow>('SELECT * FROM pipo_run_steps WHERE run_id = ? ORDER BY id', runId)
    .map((r) => ({ id: r.id, runId: r.run_id, key: r.step_key, title: r.title, kind: r.kind, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, preview: r.preview, error: r.error }));
}

export function setStep(runId: number, key: string, patch: { status: StepStatus; preview?: string | null; error?: string | null }): void {
  const now = new Date().toISOString();
  db().run(
    `UPDATE pipo_run_steps SET status = ?,
       started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
       finished_at = CASE WHEN ? IN ('done', 'failed', 'skipped') THEN ? ELSE finished_at END,
       preview = COALESCE(?, preview), error = COALESCE(?, error)
     WHERE run_id = ? AND step_key = ?`,
    patch.status,
    patch.status,
    now,
    patch.status,
    now,
    patch.preview ?? null,
    patch.error ?? null,
    runId,
    key,
  );
}

/** Execuções que ficaram "rodando" quando o app fechou viram canceladas na abertura. */
export function closeOrphanRuns(): number {
  return db().run("UPDATE pipo_runs SET status = 'cancelled', finished_at = ?, error = 'O app fechou durante a execução.' WHERE status IN ('running', 'waiting', 'queued')", new Date().toISOString()).changes;
}

export function deleteOldRuns(days: number): number {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db().run('DELETE FROM pipo_runs WHERE started_at < ?', since).changes;
}

/** Falhas seguidas mais recentes (execuções reais), para a pausa automática. */
export function consecutiveFailures(pipoId: number): number {
  const rows = db().all<{ status: RunStatus }>("SELECT status FROM pipo_runs WHERE pipo_id = ? AND dry_run = 0 AND status IN ('done', 'failed') ORDER BY id DESC LIMIT 5", pipoId);
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'failed') break;
    n++;
  }
  return n;
}

// ---------- Memória e permissões ----------

export function listMemory(pipoId: number): PipoMemoryRule[] {
  return db()
    .all<{ id: number; pipo_id: number; rule: string; source: string; created_at: string }>('SELECT * FROM pipo_memory WHERE pipo_id = ? ORDER BY id', pipoId)
    .map((r) => ({ id: r.id, pipoId: r.pipo_id, rule: r.rule, source: r.source, createdAt: r.created_at }));
}

export function addMemory(pipoId: number, rule: string, source = 'chat'): PipoMemoryRule {
  const { lastId } = db().run('INSERT INTO pipo_memory (pipo_id, rule, source, created_at) VALUES (?, ?, ?, ?)', pipoId, rule.trim(), source, new Date().toISOString());
  return listMemory(pipoId).find((m) => m.id === lastId) as PipoMemoryRule;
}

export function deleteMemory(id: number): void {
  db().run('DELETE FROM pipo_memory WHERE id = ?', id);
}

export function getPermission(pipoId: number, stepKey: string): { alwaysAllow: boolean; limitN: number | null } {
  const r = db().get<{ always_allow: number; limit_n: number | null }>('SELECT always_allow, limit_n FROM pipo_permissions WHERE pipo_id = ? AND step_key = ?', pipoId, stepKey);
  return { alwaysAllow: !!r?.always_allow, limitN: r?.limit_n ?? null };
}

export function setPermission(pipoId: number, stepKey: string, alwaysAllow: boolean, limitN: number | null): void {
  db().run(
    `INSERT INTO pipo_permissions (pipo_id, step_key, always_allow, limit_n) VALUES (?, ?, ?, ?)
     ON CONFLICT(pipo_id, step_key) DO UPDATE SET always_allow = excluded.always_allow, limit_n = excluded.limit_n`,
    pipoId,
    stepKey,
    alwaysAllow,
    limitN,
  );
}

/** Métricas declaradas na versão ativa. */
export function metricDefs(pipoId: number): MetricDef[] {
  return activePlaybook(pipoId)?.playbook.metrics ?? [];
}
