// Junta leituras iguais em blocos contínuos e grava no banco (seção 9.5). Sem dependência do Electron.
import type { ActivityCategory, CurrentActivity } from '@shared/types';
import { extendBlock, insertBlock } from '../db/repos/activity';
import type { Classification } from './classifier';

export interface Reading {
  app: string;
  title: string;
  url: string | null;
}

/** Leituras separadas por mais que isso (ex.: computador dormiu) não são unidas. */
export const MAX_GAP_MS = 20_000;

interface Current {
  id: number;
  startedAt: number;
  lastAt: number;
  app: string;
  title: string;
  url: string | null;
  category: ActivityCategory;
  clientId: number | null;
  idle: boolean;
  distraction: string | null;
}

export class BlockRecorder {
  private cur: Current | null = null;

  constructor(private classifyFn: (r: Reading) => Classification) {}

  current(): CurrentActivity | null {
    if (!this.cur) return null;
    return { app: this.cur.app, title: this.cur.title, url: this.cur.url, category: this.cur.category, clientId: this.cur.clientId, since: this.cur.startedAt };
  }

  currentDistraction(): string | null {
    return this.cur?.distraction ?? null;
  }

  /** Para de registrar (pausado, app ignorado): o bloco atual termina na última leitura. */
  stop(): void {
    this.cur = null;
  }

  /** Ocioso desde `since` (ms): corta o bloco atual e abre um bloco `idle`. */
  idle(now: number, since: number): void {
    if (this.cur?.idle) {
      this.touch(now);
      return;
    }
    if (this.cur && this.cur.lastAt > since) {
      this.cur.lastAt = Math.max(this.cur.startedAt, since);
      extendBlock(this.cur.id, new Date(this.cur.lastAt).toISOString());
    }
    const start = this.cur && now - this.cur.lastAt <= MAX_GAP_MS + (now - since) ? Math.max(since, this.cur.lastAt) : since;
    this.open({ app: 'Ocioso', title: '', url: null }, { category: 'idle', clientId: null, distraction: null }, start, now, true);
  }

  ingest(r: Reading, now: number): Current {
    const c = this.cur;
    if (c && !c.idle && c.app === r.app && c.title === r.title && c.url === r.url && now - c.lastAt <= MAX_GAP_MS) {
      this.touch(now);
      return c;
    }
    const cls = this.classifyFn(r);
    // Troca detectada nesta leitura: o bloco anterior vai até agora e o novo começa agora (sem buracos).
    if (c && now - c.lastAt <= MAX_GAP_MS) extendBlock(c.id, new Date(now).toISOString());
    return this.open(r, cls, now, now, false);
  }

  private touch(now: number): void {
    if (!this.cur) return;
    this.cur.lastAt = now;
    extendBlock(this.cur.id, new Date(now).toISOString());
  }

  private open(r: Reading, cls: Classification, start: number, now: number, idle: boolean): Current {
    const end = Math.max(start, now);
    const id = insertBlock({
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      app: r.app,
      title: r.title,
      url: r.url,
      category: cls.category,
      clientId: cls.clientId,
      idle,
    });
    this.cur = { id, startedAt: start, lastAt: end, app: r.app, title: r.title, url: r.url, category: cls.category, clientId: cls.clientId, idle, distraction: cls.distraction };
    return this.cur;
  }
}
