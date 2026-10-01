// SQLite local. Usa o `node:sqlite` embutido no Electron (Node 24): sem módulo nativo para
// recompilar por plataforma. A API síncrona é equivalente à do better-sqlite3.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import migrations from './migrations';

export type Row = Record<string, SQLInputValue>;
export type Param = SQLInputValue | boolean | undefined;

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private norm(params: Param[]): SQLInputValue[] {
    return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...this.norm(params)) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...this.norm(params)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...this.norm(params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = row.user_version;
    for (let v = current; v < migrations.length; v++) {
      this.tx(() => {
        this.raw.exec(migrations[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  close(): void {
    this.raw.close();
  }
}

let instance: Db | null = null;

export function openDb(file: string): Db {
  instance = new Db(file);
  return instance;
}

export function db(): Db {
  if (!instance) throw new Error('Banco não inicializado');
  return instance;
}
