import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-lnk-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  shell: {},
  protocol: {},
  powerMonitor: {},
}));
const { openDb, db } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { execute, runnerHooks } = await import('../src/main/pipos/runner');
const links = await import('../src/main/pipos/links');
const { EMPTY_PLAYBOOK } = await import('../src/shared/pipos');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

function hire(name: string, script: string): ReturnType<typeof repo.createPipo> {
  const p = repo.createPipo({ name, color: 'orange', personality: { mission: '', tone: '', never: [] } });
  writeFileSync(join(repo.pipoDir(p.slug), 'scripts', 's.js'), script);
  return p;
}

const deps = (handoffs: Array<{ to: string; payload: unknown }>): Deps => ({
  agent: async () => '',
  confirm: async () => 'yes',
  notify: () => undefined,
  gfetch: async () => ({}) as never,
  fetch: (...a) => fetch(...a),
  handoff: async (o) => {
    handoffs.push({ to: o.to, payload: o.payload });
    // Igual ao real: grava na caixa de entrada do outro Pipo.
    const to = repo.getPipo(o.to)!;
    const file = join(repo.pipoDir(to.slug), 'inbox', 'x.json');
    writeFileSync(file, JSON.stringify(o.payload));
    const link = db().get<{ delay_min: number }>("SELECT delay_min FROM pipo_links WHERE from_pipo_id = ? AND to_pipo_id = ?", o.from.id, to.id);
    db().run("INSERT INTO pipo_inbox (to_pipo_id, from_run_id, payload_path, status, run_after, created_at) VALUES (?, ?, ?, 'pending', ?, ?)", to.id, o.runId, file, new Date(Date.now() + (link?.delay_min ?? 0) * 60_000).toISOString(), new Date().toISOString());
    return 'ok';
  },
  askPipo: async () => '',
  update: () => undefined,
});

describe('conexão entre Pipos', () => {
  it('A gera uma lista, entrega para B, e B roda 2 min depois com a lista como entrada', async () => {
    openDb(':memory:');
    const a = hire('Gerador', `console.log(JSON.stringify({ itens: ['x', 'y', 'z'] }))`);
    const b = hire('Recebedor', 'console.log(1)');
    repo.addVersion(b.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'n', title: 'Recebi {{entrada | length}}' }] }, 'v1');
    links.setAfterLink(a.id, b.id, 2);
    db().run("DELETE FROM pipo_links"); // a entrega abaixo usa o handoff; o atraso vem do link
    db().run("INSERT INTO pipo_links (from_pipo_id, to_pipo_id, kind, delay_min, enabled) VALUES (?, ?, 'after', 2, 1)", a.id, b.id);
    const handoffs: Array<{ to: string; payload: unknown }> = [];
    const r = await execute({ pipo: a, version: 1, dryRun: false, trigger: 'manual', playbook: { ...EMPTY_PLAYBOOK, steps: [{ kind: 'script', key: 'gerar', title: 'Gerar', command: 'node', args: ['scripts/s.js'] }, { kind: 'handoff', key: 'entregar', title: 'Entregar', to: b.slug, payload: '{{passos.gerar.saida.itens}}', run: true }] } }, deps(handoffs));
    expect(r.status).toBe('done');
    expect(handoffs).toEqual([{ to: b.slug, payload: ['x', 'y', 'z'] }]);
    const ran: Array<{ to: string; input: unknown }> = [];
    const runFn = async (p: { slug: string }, input: unknown): Promise<void> => void ran.push({ to: p.slug, input });
    expect(await links.processInbox(new Date(Date.now() + 60_000), runFn)).toBe(0);
    expect(await links.processInbox(new Date(Date.now() + 3 * 60_000), runFn)).toBeGreaterThan(0);
    expect(ran[0]).toEqual({ to: b.slug, input: ['x', 'y', 'z'] });
  });

  it('"depois de": só roda se o anterior terminar bem', async () => {
    openDb(':memory:');
    const a = hire('Primeiro', 'process.exit(1)');
    const b = hire('Segundo', 'console.log(1)');
    repo.addVersion(b.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'n', title: 'oi' }] }, 'v1');
    links.setAfterLink(a.id, b.id, 0);
    runnerHooks.finished.splice(0, runnerHooks.finished.length, links.onRunFinished);
    const play = { ...EMPTY_PLAYBOOK, steps: [{ kind: 'script' as const, key: 's', title: 'S', command: 'node', args: ['scripts/s.js'] }] };
    const failed = await execute({ pipo: a, version: 1, dryRun: false, trigger: 'manual', playbook: play }, deps([]));
    expect(failed.status).toBe('failed');
    expect(db().get<{ n: number }>("SELECT COUNT(*) AS n FROM pipo_inbox")?.n).toBe(0);
    writeFileSync(join(repo.pipoDir(a.slug), 'scripts', 's.js'), 'console.log(JSON.stringify({ok:true}))');
    const ok = await execute({ pipo: a, version: 1, dryRun: false, trigger: 'manual', playbook: play }, deps([]));
    expect(ok.status).toBe('done');
    const ran: string[] = [];
    await links.processInbox(new Date(Date.now() + 1000), async (p) => void ran.push(p.slug));
    expect(ran).toEqual([b.slug]);
  });

  it('A → B → A é recusado com explicação', () => {
    openDb(':memory:');
    const a = hire('Alfa', '');
    const b = hire('Beta', '');
    const c = hire('Gama', '');
    links.setAfterLink(a.id, b.id, 0);
    links.setAfterLink(b.id, c.id, 0);
    expect(() => links.setAfterLink(c.id, a.id, 0)).toThrow(/ciclo/);
    expect(() => links.setAfterLink(b.id, a.id, 0)).toThrow(/ciclo/);
    expect(links.wouldCycle(a.id, c.id)).toBe(false);
  });
});
