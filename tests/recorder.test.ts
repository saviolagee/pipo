import { beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../src/main/activity/classifier';
import { BlockRecorder } from '../src/main/activity/recorder';
import { computeWorkTime } from '../src/main/activity/worktime';
import { openDb } from '../src/main/db';
import { blocksBetween } from '../src/main/db/repos/activity';
import type { Client } from '../src/shared/types';

const clients: Client[] = [{ id: 1, name: 'Pró-Saúde', keywords: ['prosaude', 'pro-saude'], color: '#000', archived: false }];
const opts = { distractions: ['YouTube', 'Instagram'], allowed: [], clients };
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const S = 1000;

describe('BlockRecorder', () => {
  beforeEach(() => {
    const db = openDb(':memory:');
    db.run("INSERT INTO clients (id, name, keywords_json, color) VALUES (1, 'Pró-Saúde', '[]', '#000')");
  });

  it('30 min alternando apps gera blocos corretos e classificados', () => {
    const rec = new BlockRecorder((r) => classify(opts, r.app, r.title, r.url));
    const timeline: Array<[number, string, string]> = [
      [0, 'Code', 'proposta-prosaude.md — docs'],
      [10 * 60, 'Google Chrome', 'Lofi - YouTube'],
      [14 * 60, 'Slack', 'geral - Empresa'],
      [20 * 60, 'Excel', 'orcamento Pró-Saúde.xlsx'],
      [30 * 60, 'Excel', 'orcamento Pró-Saúde.xlsx'],
    ];
    // Leitura a cada 5s, como o tracker real.
    for (let i = 0; i < timeline.length - 1; i++) {
      const [from, app, title] = timeline[i];
      const to = timeline[i + 1][0];
      for (let t = from; t < to; t += 5) rec.ingest({ app, title, url: null }, T0 + t * S);
    }
    rec.ingest({ app: 'Excel', title: 'orcamento Pró-Saúde.xlsx', url: null }, T0 + 30 * 60 * S);

    const blocks = blocksBetween(new Date(T0).toISOString(), new Date(T0 + 3600 * S).toISOString());
    expect(blocks.map((b) => [b.app, b.category, b.clientId])).toEqual([
      ['Code', 'client', 1],
      ['Google Chrome', 'distraction', null],
      ['Slack', 'work', null],
      ['Excel', 'client', 1],
    ]);
    // Blocos contíguos, sem buracos.
    expect(blocks[1].startedAt).toBe(blocks[0].endedAt);
    expect((Date.parse(blocks[3].endedAt) - Date.parse(blocks[3].startedAt)) / 60_000).toBe(10);

    const wt = computeWorkTime(
      { start: T0, end: T0 + 3600 * S },
      blocks.map((b) => ({ start: Date.parse(b.startedAt), end: Date.parse(b.endedAt), category: b.category, idle: b.idle })),
      [],
    );
    expect(wt.workedMin).toBe(26);
    expect(wt.distractedMin).toBe(4);
  });

  it('ociosidade corta o bloco e abre um bloco idle retroativo', () => {
    const rec = new BlockRecorder((r) => classify(opts, r.app, r.title, r.url));
    for (let t = 0; t <= 600; t += 5) rec.ingest({ app: 'Code', title: 'a.ts', url: null }, T0 + t * S);
    // Às 10 min o sistema diz que está ocioso há 4 min.
    rec.idle(T0 + 600 * S, T0 + 360 * S);
    rec.idle(T0 + 900 * S, T0 + 360 * S);
    const blocks = blocksBetween(new Date(T0).toISOString(), new Date(T0 + 3600 * S).toISOString());
    expect(blocks.map((b) => b.category)).toEqual(['work', 'idle']);
    expect(blocks[0].endedAt).toBe(new Date(T0 + 360 * S).toISOString());
    expect(blocks[1].endedAt).toBe(new Date(T0 + 900 * S).toISOString());
  });
});
