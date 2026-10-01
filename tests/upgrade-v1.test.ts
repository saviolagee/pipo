// Atualizar da V1 (banco só com a migração 001) mantém tarefas, histórico e configurações.
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import m001 from '../src/main/db/migrations/001_init';
import migrations from '../src/main/db/migrations';

const dir = mkdtempSync(join(tmpdir(), 'pipo-upgrade-'));
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo' } }));
const { openDb, db } = await import('../src/main/db');
const { getSettings } = await import('../src/main/db/repos/settings');

describe('atualizar da V1', () => {
  it('migra sem perder tarefas, conversas e configurações; o agente passa a usar o Sonnet', () => {
    const file = join(dir, 'pipo.db');
    const v1 = new DatabaseSync(file);
    v1.exec(m001);
    v1.exec('PRAGMA user_version = 1');
    const now = new Date().toISOString();
    v1.prepare('INSERT INTO tasks (title, status, is_today, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run('Proposta do cliente', 'todo', now, now);
    v1.prepare('INSERT INTO tasks (title, status, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)').run('Enviar nota', 'done', now, now, now);
    v1.prepare('INSERT INTO conversations (created_at, title) VALUES (?, ?)').run(now, 'Planejar semana');
    v1.prepare('INSERT INTO messages (conversation_id, role, content_json, created_at) VALUES (1, ?, ?, ?)').run('user', JSON.stringify({ text: 'oi' }), now);
    v1.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run('app', JSON.stringify({ volume: 0.2, muted: true, shortcuts: { toggle: 'Alt+Space', quickCapture: 'Alt+K' } }));
    v1.close();

    openDb(file);
    expect(db().get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(migrations.length);
    expect(db().all<{ title: string; status: string }>('SELECT title, status FROM tasks ORDER BY id')).toEqual([
      { title: 'Proposta do cliente', status: 'todo' },
      { title: 'Enviar nota', status: 'done' },
    ]);
    expect(db().get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')?.n).toBe(1);
    expect(db().get<{ title: string }>('SELECT title FROM conversations')?.title).toBe('Planejar semana');
    const s = getSettings();
    expect(s.volume).toBe(0.2);
    expect(s.muted).toBe(true);
    expect(s.shortcuts.toggle).toBe('Alt+Space');
    // Atalho novo da V2 entra com o padrão, sem apagar os da V1.
    expect(s.shortcuts.focusNext).toBe('CommandOrControl+Shift+F');
    expect(s.agent.model).toBe('sonnet');
    // Tabelas novas existem e começam vazias: nenhum Pipo vem instalado.
    expect(db().get<{ n: number }>('SELECT COUNT(*) AS n FROM pipos')?.n).toBe(0);
    expect(db().get<{ n: number }>('SELECT COUNT(*) AS n FROM day_status')?.n).toBe(0);
  });
});
