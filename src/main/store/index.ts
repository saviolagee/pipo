// Loja de Pipos: instala um Pipo pronto do catálogo (cria, copia os scripts, guarda a configuração e
// as chaves, fixa o plano e a agenda) e deixa reconfigurar depois, sem passar pelo /criarpipo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePlaybook } from '@shared/plan-check';
import type { StoreConfig, StoreItem } from '@shared/team';
import { emit } from '../bus';
import { getKV, setKV } from '../db/repos/settings';
import { handle } from '../ipc';
import { builderHooks } from '../pipos/builder-tools';
import { pipesChanged, removePipo } from '../pipos/ipc';
import { writeFiles } from '../pipos/models';
import { addVersion, createPipo, getPipo, listPipos, listTriggers, pipoDir } from '../pipos/repo';
import { secretNames, setPipoSecret } from '../pipos/secrets';
import { applyDraftTriggers } from '../pipos/triggers';
import { SCHEDULE_FIELD, type StoreDef } from './catalog';
import { PROSPECTOR } from './prospector';

export const CATALOG: StoreDef[] = [PROSPECTOR];

const itemKey = (pipoId: number): string => `store:item:${pipoId}`;
const configFile = (slug: string): string => join(pipoDir(slug), 'data', 'config.json');

/** De que item da loja veio este Pipo (null se foi criado pelo usuário). */
export function storeItemOf(pipoId: number): StoreDef | null {
  const id = getKV<string | null>(itemKey(pipoId), null);
  return CATALOG.find((d) => d.id === id) ?? null;
}

function installedSlug(def: StoreDef): string | null {
  return listPipos().find((p) => storeItemOf(p.id)?.id === def.id)?.slug ?? null;
}

export function listStore(): StoreItem[] {
  return CATALOG.map((d) => ({ id: d.id, name: d.name, tagline: d.tagline, does: d.does, color: d.color, accessory: d.accessory, fields: d.fields, installed: installedSlug(d) }));
}

function readConfig(slug: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configFile(slug), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Guarda o que o usuário preencheu: segredos no cofre, agenda no gatilho, o resto no config.json. */
function applyValues(pipoId: number, def: StoreDef, values: Record<string, string>, first: boolean): void {
  const p = getPipo(pipoId);
  if (!p) throw new Error('Pipo não encontrado.');
  const config = readConfig(p.slug);
  for (const f of def.fields) {
    const raw = values[f.key];
    if (raw === undefined) continue;
    const v = String(raw).trim();
    if (f.kind === 'secret') {
      // Campo de senha vazio = deixa a que já está guardada.
      if (v) setPipoSecret(p.slug, f.key, v);
    } else if (f.key === SCHEDULE_FIELD) {
      const current = listTriggers(pipoId).find((t) => t.kind === 'schedule');
      const currentText = current && 'text' in current.spec ? String(current.spec.text) : '';
      if (first || v !== currentText) applyDraftTriggers(pipoId, { schedule: v || null, after: null, events: [] });
    } else config[f.key] = f.kind === 'number' ? (v === '' ? undefined : Number(v)) : v;
  }
  mkdirSync(join(pipoDir(p.slug), 'data'), { recursive: true });
  writeFileSync(configFile(p.slug), JSON.stringify(config, null, 2));
}

function checkRequired(def: StoreDef, values: Record<string, string>): void {
  const missing = def.fields.filter((f) => f.required && !String(values[f.key] ?? '').trim()).map((f) => f.label);
  if (missing.length) throw new Error(`Falta preencher: ${missing.join(', ')}.`);
}

/** Instala um Pipo da loja, já contratado e pronto para rodar. */
export function installItem(id: string, values: Record<string, string>): { pipoId: number; slug: string } {
  const def = CATALOG.find((d) => d.id === id);
  if (!def) throw new Error('Esse Pipo não está mais na loja.');
  checkRequired(def, values);
  const p = createPipo({ name: def.name, color: def.color, accessory: def.accessory, personality: def.personality, model: def.model, effort: def.effort });
  try {
    setKV(itemKey(p.id), def.id);
    writeFiles(p.slug, def.files);
    addVersion(p.id, normalizePlaybook(def.playbook), 'Instalado da loja');
    applyValues(p.id, def, { [SCHEDULE_FIELD]: '', ...values }, true);
  } catch (e) {
    // Instalação pela metade não fica na equipe (ex.: o cofre do sistema recusou guardar a senha).
    removePipo(p.id);
    throw e;
  }
  builderHooks.introduce(p.id, def.intro);
  emit('pipos:hired', { pipoId: p.id, version: 1 });
  pipesChanged();
  return { pipoId: p.id, slug: p.slug };
}

export function getConfig(pipoId: number): StoreConfig | null {
  const p = getPipo(pipoId);
  const def = p ? storeItemOf(pipoId) : null;
  if (!p || !def) return null;
  const config = readConfig(p.slug);
  const schedule = listTriggers(pipoId).find((t) => t.kind === 'schedule');
  const values: Record<string, string> = {};
  for (const f of def.fields) {
    if (f.kind === 'secret') continue;
    values[f.key] = f.key === SCHEDULE_FIELD ? (schedule && 'text' in schedule.spec ? String(schedule.spec.text) : '') : config[f.key] === undefined || config[f.key] === null ? '' : String(config[f.key]);
  }
  return { itemId: def.id, name: p.name, fields: def.fields, values, secretsSet: secretNames(p.slug) };
}

export function saveConfig(pipoId: number, values: Record<string, string>): StoreConfig {
  const def = storeItemOf(pipoId);
  if (!def) throw new Error('Este Pipo não veio da loja.');
  checkRequired(def, values);
  applyValues(pipoId, def, values, false);
  pipesChanged();
  return getConfig(pipoId) as StoreConfig;
}

/** Os scripts de um Pipo da loja acompanham o app: a cada abertura, recebem as correções da versão nova. */
export function syncInstalled(): number {
  let n = 0;
  for (const p of listPipos()) {
    const def = storeItemOf(p.id);
    if (!def || !existsSync(pipoDir(p.slug))) continue;
    writeFiles(p.slug, def.files);
    n++;
  }
  return n;
}

export function registerStore(): void {
  try {
    syncInstalled();
  } catch (e) {
    console.warn('[loja] não atualizei os scripts:', e);
  }
  handle('store:list', () => listStore());
  handle('store:install', (id, values) => installItem(id, values));
  handle('store:config', (pipoId) => getConfig(pipoId));
  handle('store:saveConfig', (pipoId, values) => saveConfig(pipoId, values));
}
