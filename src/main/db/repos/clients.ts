import type { Client } from '@shared/types';
import { db } from '../index';

interface ClientRow {
  id: number;
  name: string;
  keywords_json: string;
  color: string;
  archived: number;
}

export const CLIENT_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#D9468F', '#A78BFA', '#14B8A6', '#F97316', '#EAB308'];

const toClient = (r: ClientRow): Client => ({
  id: r.id,
  name: r.name,
  keywords: JSON.parse(r.keywords_json) as string[],
  color: r.color,
  archived: !!r.archived,
});

export function listClients(includeArchived = false): Client[] {
  return db()
    .all<ClientRow>(`SELECT * FROM clients ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`)
    .map(toClient);
}

export function getClient(id: number): Client | null {
  const r = db().get<ClientRow>('SELECT * FROM clients WHERE id = ?', id);
  return r ? toClient(r) : null;
}

/** Normaliza para comparação: minúsculas, sem acentos. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Palavras-chave padrão a partir do nome ("Pró-Saúde" → pro-saude, prosaude, pro saude). */
export function keywordsFromName(name: string): string[] {
  const n = norm(name).trim();
  const set = new Set([n, n.replace(/[^a-z0-9]+/g, '-'), n.replace(/[^a-z0-9]+/g, '')]);
  return [...set].filter((k) => k.length >= 3);
}

/**
 * Salva o conjunto de clientes: atualiza os que têm id, cria os novos e arquiva os removidos
 * (para não perder o histórico de tempo associado).
 */
export function saveClients(items: Array<Omit<Client, 'id'> & { id?: number }>): Client[] {
  db().tx(() => {
    const keep = new Set<number>();
    items.forEach((c, i) => {
      const keywords = c.keywords.length ? c.keywords : keywordsFromName(c.name);
      const color = c.color || CLIENT_COLORS[i % CLIENT_COLORS.length];
      if (c.id) {
        db().run('UPDATE clients SET name = ?, keywords_json = ?, color = ?, archived = ? WHERE id = ?', c.name.trim(), JSON.stringify(keywords), color, c.archived, c.id);
        keep.add(c.id);
      } else {
        const { lastId } = db().run('INSERT INTO clients (name, keywords_json, color, archived) VALUES (?, ?, ?, 0)', c.name.trim(), JSON.stringify(keywords), color);
        keep.add(lastId);
      }
    });
    for (const c of listClients()) {
      if (!keep.has(c.id)) db().run('UPDATE clients SET archived = 1 WHERE id = ?', c.id);
    }
  });
  return listClients();
}

/** Encontra um cliente por nome ou palavra-chave (usado pelo parser e pelo agente). */
export function findClient(text: string): Client | null {
  const t = norm(text);
  for (const c of listClients()) {
    if (norm(c.name) === t) return c;
    if (c.keywords.some((k) => norm(k) === t)) return c;
  }
  for (const c of listClients()) {
    if (t.includes(norm(c.name)) || c.keywords.some((k) => t.includes(norm(k)))) return c;
  }
  return null;
}
