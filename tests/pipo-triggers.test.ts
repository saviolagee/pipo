import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-trg-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  shell: {},
  protocol: {},
  powerMonitor: {},
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { tickTriggers, applyDraftTriggers, blockedReason } = await import('../src/main/pipos/triggers');
const days = await import('../src/main/db/repos/days');
const { EMPTY_PLAYBOOK } = await import('../src/shared/pipos');

function hired(name: string, runOnDaysOff = false): ReturnType<typeof repo.createPipo> {
  const p = repo.createPipo({ name, color: 'green', personality: { mission: '', tone: '', never: [] }, runOnDaysOff });
  repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'A' }] }, 'v1');
  return repo.getPipo(p.id) as ReturnType<typeof repo.createPipo>;
}

describe('gatilhos', () => {
  it('uma agenda a cada 2 min dispara 2 vezes em 4 minutos', async () => {
    openDb(':memory:');
    const p = hired('Agendado');
    repo.addTrigger(p.id, 'schedule', { text: 'a cada 2 min', cron: '*/2 * * * *' });
    let clock = new Date(2026, 9, 1, 10, 0, 30);
    const runs: string[] = [];
    const deps = { now: () => clock, run: async (_id: number, t: string) => void runs.push(t), askMissed: async () => true };
    let since = clock.toISOString();
    for (let i = 0; i < 8; i++) {
      clock = new Date(clock.getTime() + 30_000);
      await tickTriggers(deps, since);
      since = clock.toISOString();
    }
    expect(runs).toEqual(['schedule', 'schedule']);
  });

  it('execução perdida com o app fechado vira pergunta; folga e pausa bloqueiam', async () => {
    openDb(':memory:');
    const p = hired('Diário');
    repo.addTrigger(p.id, 'schedule', { text: 'todo dia 9h', cron: '0 9 * * *' });
    const asked: string[] = [];
    const runs: string[] = [];
    const deps = { now: () => new Date(2026, 9, 1, 11, 0), run: async (_id: number, t: string) => void runs.push(t), askMissed: async (_p: unknown, at: Date) => (asked.push(at.toTimeString().slice(0, 5)), true) };
    await tickTriggers(deps, new Date(2026, 9, 1, 8, 0).toISOString());
    expect(asked).toEqual(['09:00']);
    expect(runs).toEqual(['schedule:recuperada']);
    days.setDay('2026-10-02', 'off');
    expect(blockedReason(repo.getPipo(p.id)!, new Date(2026, 9, 2, 9, 0))).toBe('dia de folga');
    repo.updatePipo(p.id, { paused: true });
    expect(blockedReason(repo.getPipo(p.id)!, new Date(2026, 9, 1, 9, 0))).toBe('pausado');
  });

  it('gatilhos do rascunho viram reais ao contratar', () => {
    openDb(':memory:');
    const a = hired('Primeiro');
    const b = hired('Segundo');
    const out = applyDraftTriggers(b.id, { schedule: 'seg–sex 9h', after: { from: a.slug, delayMin: 4320 }, events: [] });
    expect(out[0]).toMatch(/^Seg–Sex às 09:00/);
    expect(out[1]).toBe(`depois de @${a.slug} (+4320 min)`);
    expect(repo.listTriggers(b.id).map((t) => t.kind)).toEqual(['schedule', 'after_pipo']);
  });
});
