import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PLAYBOOK } from '../src/shared/pipos';

const dir = mkdtempSync(join(tmpdir(), 'pipo-files-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo' },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`x${s}`), decryptString: (b: Buffer) => b.toString().slice(1) },
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { setPipoSecret } = await import('../src/main/pipos/secrets');
const models = await import('../src/main/pipos/models');

describe('arquivo .pipo', () => {
  it('exporta e importa com plano, scripts e nomes de segredos (sem valores)', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Exportável', color: 'cyan', personality: { mission: 'testar', tone: 'direto', never: ['enviar sem pedir'] } });
    writeFileSync(join(repo.pipoDir(p.slug), 'scripts', 'puxar.js'), 'console.log(1)');
    setPipoSecret(p.slug, 'API_TOKEN', 'valor-secreto-999');
    repo.addVersion(p.id, { ...EMPTY_PLAYBOOK, steps: [{ kind: 'notify', key: 'a', title: 'A' }] }, 'v1');

    const text = models.exportPipo(p.id);
    expect(text).not.toContain('valor-secreto-999');
    const j = JSON.parse(text) as { format: string; secrets: string[]; files: Record<string, string> };
    expect(j.format).toBe('pipo/1');
    expect(j.secrets).toEqual(['API_TOKEN']);
    expect(j.files['scripts/puxar.js']).toBe('console.log(1)');

    const m = models.importPipo(text);
    expect(m.name).toBe('Exportável');
    expect(m.color).toBe('cyan');
    expect(m.playbook.steps).toHaveLength(1);
    expect(m.personality.never).toEqual(['enviar sem pedir']);
    expect(models.listModels().map((x) => x.id)).toContain(m.id);
  });

  it('recusa arquivos inválidos e não grava fora da pasta do Pipo', () => {
    openDb(':memory:');
    expect(() => models.importPipo('não é json')).toThrow();
    expect(() => models.importPipo(JSON.stringify({ format: 'outro' }))).toThrow();
    const p = repo.createPipo({ name: 'Destino', color: 'orange', personality: { mission: 'x', tone: 'y', never: [] } });
    models.writeFiles(p.slug, { 'scripts/ok.js': 'ok', '../fora.js': 'mal', 'scripts/../../fora2.js': 'mal', 'outra/x.js': 'mal' });
    expect(readFileSync(join(repo.pipoDir(p.slug), 'scripts', 'ok.js'), 'utf8')).toBe('ok');
    expect(existsSync(join(repo.pipoDir(p.slug), '..', 'fora.js'))).toBe(false);
    expect(existsSync(join(repo.pipoDir(p.slug), '..', 'fora2.js'))).toBe(false);
    expect(existsSync(join(repo.pipoDir(p.slug), 'outra'))).toBe(false);
  });
});
