// Modelos próprios ("Salvar como modelo") e o arquivo .pipo para compartilhar (Fase 23).
// Levam personalidade, plano, gatilho em texto, nomes dos segredos (nunca os valores) e os arquivos
// do Pipo (scripts/, templates/, mcp.json).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { EMPTY_PLAYBOOK, PIPO_COLORS, type PipoColor, type PipoModel, type PipoPlaybook } from '@shared/pipos';
import { normalizePlaybook } from '@shared/plan-check';
import { db } from '../db';
import { activePlaybook, ensurePipoDirs, getPipo, listTriggers, pipoDir } from './repo';
import { secretNames } from './secrets';

const MAX_FILES_BYTES = 2_000_000;
export const PIPO_FORMAT = 'pipo/1';

interface ModelRow {
  id: number;
  name: string;
  personality_json: string;
  playbook_json: string;
  color: PipoModel['color'];
  accessory: PipoModel['accessory'];
  secrets_json: string;
  files_json: string;
  triggers_json: string;
  created_at: string;
}

export interface ModelExtras {
  files: Record<string, string>;
  triggers: { schedule: string | null };
}

const toModel = (r: ModelRow): PipoModel & ModelExtras => ({
  id: r.id,
  name: r.name,
  color: r.color,
  accessory: r.accessory,
  personality: JSON.parse(r.personality_json) as PipoModel['personality'],
  playbook: { ...EMPTY_PLAYBOOK, ...(JSON.parse(r.playbook_json) as Partial<PipoPlaybook>) },
  secrets: JSON.parse(r.secrets_json) as string[],
  createdAt: r.created_at,
  files: JSON.parse(r.files_json || '{}') as Record<string, string>,
  triggers: { schedule: null, ...(JSON.parse(r.triggers_json || '{}') as Partial<ModelExtras['triggers']>) },
});

export function listModels(): Array<PipoModel & ModelExtras> {
  return db().all<ModelRow>('SELECT * FROM pipo_models ORDER BY id DESC').map(toModel);
}

export function getModel(id: number): (PipoModel & ModelExtras) | null {
  const r = db().get<ModelRow>('SELECT * FROM pipo_models WHERE id = ?', id);
  return r ? toModel(r) : null;
}

export function insertModel(m: Omit<PipoModel, 'id' | 'createdAt'> & Partial<ModelExtras>): PipoModel & ModelExtras {
  const { lastId } = db().run(
    'INSERT INTO pipo_models (name, personality_json, playbook_json, color, accessory, secrets_json, files_json, triggers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    m.name,
    JSON.stringify(m.personality),
    JSON.stringify(m.playbook),
    m.color,
    m.accessory,
    JSON.stringify(m.secrets),
    JSON.stringify(m.files ?? {}),
    JSON.stringify(m.triggers ?? { schedule: null }),
    new Date().toISOString(),
  );
  return getModel(lastId) as PipoModel & ModelExtras;
}

export function deleteModel(id: number): void {
  db().run('DELETE FROM pipo_models WHERE id = ?', id);
}

/** Arquivos do Pipo (texto) para levar junto: scripts/, templates/, mcp.json. */
export function collectFiles(slug: string): Record<string, string> {
  const root = pipoDir(slug);
  const out: Record<string, string> = {};
  let total = 0;
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.size < 512_000) {
        total += st.size;
        if (total > MAX_FILES_BYTES) throw new Error('Os arquivos do Pipo passam de 2 MB.');
        out[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(join(root, 'scripts'));
  walk(join(root, 'templates'));
  if (existsSync(join(root, 'mcp.json'))) out['mcp.json'] = readFileSync(join(root, 'mcp.json'), 'utf8');
  return out;
}

/** Grava os arquivos de um modelo na pasta de um Pipo (só dentro dela). */
export function writeFiles(slug: string, files: Record<string, string>): void {
  const root = ensurePipoDirs(slug);
  for (const [rel, content] of Object.entries(files)) {
    if (!/^(scripts|templates)\/[\w./-]+$|^mcp\.json$/.test(rel) || rel.includes('..')) continue;
    const full = resolve(root, rel);
    if (!full.startsWith(resolve(root) + sep)) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export function modelFromPipo(pipoId: number): Omit<PipoModel, 'id' | 'createdAt'> & ModelExtras {
  const p = getPipo(pipoId);
  const v = p ? activePlaybook(pipoId) : null;
  if (!p || !v) throw new Error('Só dá para salvar ou exportar um Pipo já contratado.');
  const schedule = listTriggers(pipoId).find((t) => t.kind === 'schedule');
  return {
    name: p.name,
    color: p.color,
    accessory: p.accessory,
    personality: p.personality,
    playbook: v.playbook,
    secrets: secretNames(p.slug),
    files: collectFiles(p.slug),
    triggers: { schedule: schedule && 'text' in schedule.spec ? (schedule.spec.text as string) : null },
  };
}

/** Conteúdo do arquivo .pipo (JSON legível). */
export function exportPipo(pipoId: number): string {
  return JSON.stringify({ format: PIPO_FORMAT, exportedAt: new Date().toISOString(), ...modelFromPipo(pipoId) }, null, 2);
}

/** Lê um .pipo e guarda como modelo próprio (os segredos vêm vazios; o /criarpipo pede). */
export function importPipo(text: string): PipoModel & ModelExtras {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Esse arquivo não é um .pipo válido.');
  }
  if (j.format !== PIPO_FORMAT) throw new Error('Esse arquivo não é um .pipo (ou é de uma versão mais nova do app).');
  const name = String(j.name ?? '').trim();
  const playbook = j.playbook as PipoPlaybook | undefined;
  if (!name || !playbook || !Array.isArray(playbook.steps)) throw new Error('O .pipo está incompleto (falta nome ou plano).');
  const color = (Object.keys(PIPO_COLORS).includes(String(j.color)) ? j.color : 'orange') as PipoColor;
  const personality = j.personality as PipoModel['personality'] | undefined;
  return insertModel({
    name,
    color,
    accessory: (j.accessory as PipoModel['accessory']) ?? 'none',
    personality: { mission: String(personality?.mission ?? ''), tone: String(personality?.tone ?? ''), never: Array.isArray(personality?.never) ? personality.never.map(String) : [] },
    playbook: normalizePlaybook({ ...EMPTY_PLAYBOOK, ...playbook }),
    secrets: Array.isArray(j.secrets) ? (j.secrets as unknown[]).map(String) : [],
    files: (j.files && typeof j.files === 'object' ? j.files : {}) as Record<string, string>,
    triggers: { schedule: typeof (j.triggers as { schedule?: unknown })?.schedule === 'string' ? ((j.triggers as { schedule: string }).schedule) : null },
  });
}
