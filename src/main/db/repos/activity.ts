import type { ActivityBlock, ActivityCategory } from '@shared/types';
import { db } from '../index';

interface BlockRow {
  id: number;
  started_at: string;
  ended_at: string;
  app: string;
  title: string;
  url: string | null;
  category: ActivityCategory;
  client_id: number | null;
  idle: number;
}

const toBlock = (r: BlockRow): ActivityBlock => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  app: r.app,
  title: r.title,
  url: r.url,
  category: r.category,
  clientId: r.client_id,
  idle: !!r.idle,
});

export function insertBlock(b: Omit<ActivityBlock, 'id'>): number {
  return db().run(
    'INSERT INTO activity_blocks (started_at, ended_at, app, title, url, category, client_id, idle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    b.startedAt,
    b.endedAt,
    b.app,
    b.title,
    b.url,
    b.category,
    b.clientId,
    b.idle,
  ).lastId;
}

export function extendBlock(id: number, endedAt: string): void {
  db().run('UPDATE activity_blocks SET ended_at = ? WHERE id = ?', endedAt, id);
}

/** Blocos que se sobrepõem a [from, to). */
export function blocksBetween(from: string, to: string): ActivityBlock[] {
  return db().all<BlockRow>('SELECT * FROM activity_blocks WHERE ended_at > ? AND started_at < ? ORDER BY started_at', from, to).map(toBlock);
}

export function setBlockClient(id: number, clientId: number | null): void {
  db().run(`UPDATE activity_blocks SET client_id = ?, category = CASE WHEN ? IS NULL THEN 'work' ELSE 'client' END WHERE id = ? AND category IN ('work', 'client')`, clientId, clientId, id);
}

export function deleteBlocks(from: string, to: string): number {
  return db().run('DELETE FROM activity_blocks WHERE started_at >= ? AND started_at < ?', from, to).changes;
}
