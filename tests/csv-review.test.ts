import { beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../src/main/activity/classifier';
import { blocksToCsv } from '../src/main/activity/export-csv';
import { BlockRecorder } from '../src/main/activity/recorder';
import { timeReport } from '../src/main/activity/review';
import { openDb } from '../src/main/db';
import { blocksBetween } from '../src/main/db/repos/activity';
import { listClients } from '../src/main/db/repos/clients';

const T0 = new Date(2026, 9, 1, 9, 0, 0).getTime();

describe('CSV x revisão do dia', () => {
  beforeEach(() => {
    const db = openDb(':memory:');
    db.run(`INSERT INTO clients (id, name, keywords_json, color) VALUES (1, 'Pró-Saúde', '["prosaude"]', '#22C55E'), (2, 'Acme', '["acme"]', '#3B82F6')`);
  });

  it('minutos por cliente no CSV batem com a revisão', () => {
    const clients = listClients();
    const rec = new BlockRecorder((r) => classify({ distractions: ['YouTube'], allowed: [], clients }, r.app, r.title, r.url));
    const plan: Array<[number, string, string]> = [
      [0, 'Code', 'prosaude-api — index.ts'],
      [37, 'Chrome', 'Acme dashboard'],
      [61, 'Chrome', 'música - YouTube'],
      [70, 'Slack', 'geral'],
      [95, 'Excel', 'Horas ACME.xlsx'],
      [140, 'Excel', 'Horas ACME.xlsx'],
    ];
    for (let i = 0; i < plan.length - 1; i++) {
      for (let m = plan[i][0] * 60; m < plan[i + 1][0] * 60; m += 5) rec.ingest({ app: plan[i][1], title: plan[i][2], url: null }, T0 + m * 1000);
    }
    rec.ingest({ app: 'Excel', title: 'Horas ACME.xlsx', url: null }, T0 + 140 * 60_000);

    const from = new Date(T0).toISOString();
    const to = new Date(T0 + 4 * 3_600_000).toISOString();
    const report = timeReport(from, to, 'client');
    const csv = blocksToCsv(blocksBetween(from, to), clients);
    const lines = csv.replace('﻿', '').trim().split('\r\n').slice(1).map((l) => l.split(';'));
    const byClient = new Map<string, number>();
    for (const l of lines) {
      if (l[7] === 'distraction') continue;
      const k = l[1] || 'Sem cliente';
      byClient.set(k, (byClient.get(k) ?? 0) + Number(l[4].replace(',', '.')));
    }
    expect(report.map((r) => [r.label, r.minutes])).toEqual([
      ['Acme', 69],
      ['Pró-Saúde', 37],
      ['Sem cliente', 25],
    ]);
    for (const r of report) expect(Math.round(byClient.get(r.label) ?? 0)).toBe(r.minutes);
  });
});
