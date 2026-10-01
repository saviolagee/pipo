import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-test-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  // Criptografia falsa, mas reversível: o valor nunca pode aparecer em texto claro no banco.
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('') + '#x'), decryptString: (b: Buffer) => b.toString().slice(0, -2).split('').reverse().join('') },
}));
const { openDb, db } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const secrets = await import('../src/main/pipos/secrets');
const { slugify, EMPTY_PLAYBOOK } = await import('../src/shared/pipos');

describe('núcleo de Pipos', () => {
  it('começa sem nenhum Pipo; cria, edita, pausa e apaga', () => {
    openDb(':memory:');
    expect(repo.listPipos()).toEqual([]);
    const p = repo.createPipo({ name: 'Prospector de Leads', color: 'orange', personality: { mission: 'Acho leads', tone: 'direto', never: ['mandar pra .gov'] } });
    expect(p.slug).toBe('prospector-de-leads');
    expect(repo.createPipo({ name: 'Prospector de leads', color: 'blue', personality: { mission: '', tone: '', never: [] } }).slug).toBe('prospector-de-leads-2');
    const paused = repo.updatePipo(p.id, { paused: true, name: 'Prospector' });
    expect(paused.paused).toBe(true);
    // Rascunho (sem plano contratado): o @nome acompanha o nome.
    expect(paused.slug).toBe('prospector');
    expect(repo.getPipo('@prospector')?.name).toBe('Prospector');
    repo.deletePipo(p.id);
    expect(repo.listPipos().map((x) => x.color)).toEqual(['blue']);
  });

  it('versões: a nova aprovada vira a ativa', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Teste', color: 'green', personality: { mission: '', tone: '', never: [] } });
    expect(repo.activePlaybook(p.id)).toBeNull();
    repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'Avisar', body: 'oi' }] }, 'v1');
    const v2 = repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [] }, 'tirei o aviso');
    expect(v2.version).toBe(2);
    expect(repo.activePlaybook(p.id)?.version).toBe(2);
    expect(repo.listVersions(p.id)).toHaveLength(2);
  });

  it('segredo salvo não aparece em texto claro e é mascarado nos logs', () => {
    openDb(':memory:');
    secrets.setPipoSecret('prospector', 'APIFY_TOKEN', 'apify_api_SUPERSECRETO123');
    expect(secrets.secretNames('prospector')).toEqual(['APIFY_TOKEN']);
    expect(secrets.getPipoSecret('prospector', 'APIFY_TOKEN')).toBe('apify_api_SUPERSECRETO123');
    const dump = JSON.stringify(db().all('SELECT * FROM settings'));
    expect(dump).not.toContain('SUPERSECRETO');
    expect(secrets.maskSecrets('erro 401 com token apify_api_SUPERSECRETO123', secrets.pipoSecrets('prospector'))).toBe('erro 401 com token ••••');
    expect(() => secrets.setPipoSecret('prospector', 'token minúsculo', 'x')).toThrow();
    secrets.deletePipoSecrets('prospector');
    expect(secrets.secretNames('prospector')).toEqual([]);
  });

  it('slug legível', () => {
    expect(slugify('Pipo Cobrança!')).toBe('pipo-cobranca');
    expect(slugify('   ')).toBe('pipo');
  });
});

describe('rascunho e versões', () => {
  it('@nome acompanha o nome enquanto é rascunho; depois de contratado fica fixo', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Resumo', color: 'green', personality: { mission: '', tone: '', never: [] } });
    expect(repo.updatePipo(p.id, { name: 'Resumidor' }).slug).toBe('resumidor');
    repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'A' }] }, 'v1');
    expect(repo.updatePipo(p.id, { name: 'Resumidor Diário' }).slug).toBe('resumidor');
  });

  it('diff legível entre versões do plano', async () => {
    const { planDiff } = await import('../src/main/pipos/builder-tools');
    const a = { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify' as const, key: 'a', title: 'Avisar' }, { kind: 'notify' as const, key: 'b', title: 'Tchau' }] };
    const b = { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify' as const, key: 'a', title: 'Avisar', body: 'novo' }, { kind: 'notify' as const, key: 'c', title: 'Oi' }] };
    expect(planDiff(a, b)).toEqual(['+ Oi', '− Tchau', '~ Avisar']);
  });
});
