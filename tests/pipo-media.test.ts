import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PipoPlaybook } from '../src/shared/pipos';

const dir = mkdtempSync(join(tmpdir(), 'pipo-media-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  BrowserWindow: class {},
  session: {},
}));
const { openDb } = await import('../src/main/db');
const { paths } = await import('../src/main/paths');
const { insertAttachment } = await import('../src/main/db/repos/conversations');
const { parseRange, fileUrl } = await import('../src/main/files/protocol');
const { clock, saveReading, readingDir } = await import('../src/main/files/video');
const { attachmentsPrompt, inputFiles } = await import('../src/main/files/for-agent');
const { stageInputFiles } = await import('../src/main/pipos/input-files');
const repo = await import('../src/main/pipos/repo');
const { execute } = await import('../src/main/pipos/runner');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

function attach(name: string, mime: string, body = 'x'): ReturnType<typeof insertAttachment> {
  mkdirSync(paths.files, { recursive: true });
  const path = join(paths.files, `abc123-${name}`);
  writeFileSync(path, body);
  return insertAttachment({ conversationId: null, filename: name, mime, path });
}

function watched(): ReturnType<typeof insertAttachment> {
  const a = attach('aula.mp4', 'video/mp4', 'vídeo de mentira');
  saveReading(a, { id: 'r1', duration: 151.4, width: 1920, height: 1080, frames: [{ t: 9.5, data: new Uint8Array([255, 216, 255]).buffer }, { t: 75, data: new Uint8Array([255, 216, 255]).buffer }], transcript: 'Oi, hoje a gente vai falar de luz.', noAudio: null });
  return a;
}

describe('vídeo em pedaços (Range)', () => {
  it('lê os três jeitos de pedir um pedaço e recusa o que passa do fim', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('itens=0-1', 1000)).toBeNull();
  });
  it('o endereço leva só o nome do arquivo', () => {
    expect(fileUrl('C:\\Users\\a\\files\\ab12-meu vídeo.mp4')).toBe('pipo-file://anexo/ab12-meu%20v%C3%ADdeo.mp4');
  });
});

describe('Pipo assiste ao vídeo', () => {
  it('guarda os quadros e uma descrição legível com a fala', () => {
    openDb(':memory:');
    const a = watched();
    const d = readingDir(a.path);
    expect(existsSync(join(d, 'quadro-01-0m10s.jpg'))).toBe(true);
    expect(existsSync(join(d, 'quadro-02-1m15s.jpg'))).toBe(true);
    const md = readFileSync(join(d, 'leitura.md'), 'utf8');
    expect(md).toContain('Duração: 2:31 · 1920×1080');
    expect(md).toContain('Oi, hoje a gente vai falar de luz.');
    expect(clock(3725)).toBe('1:02:05');
  });

  it('a conversa recebe imagem para abrir e vídeo já assistido', async () => {
    openDb(':memory:');
    const img = attach('capa.png', 'image/png');
    const video = watched();
    let watching = 0;
    const text = await attachmentsPrompt([img, video], () => watching++);
    expect(watching).toBe(1);
    expect(text).toContain(`- capa.png (imagem): ${img.path}. Abra com Read para ver.`);
    expect(text).toContain('aula.mp4 (vídeo de 2:31, 1920×1080)');
    expect(text).toContain(join(readingDir(video.path), 'leitura.md'));
  });
});

describe('Pipo colorido recebe arquivos', () => {
  it('só aceita anexos de verdade e entrega o vídeo com quadros e fala', async () => {
    openDb(':memory:');
    const img = attach('foto.jpg', 'image/jpeg');
    const video = watched();
    await expect(inputFiles(['C:\\Windows\\win.ini'])).rejects.toThrow(/não foi anexado/);
    const files = await inputFiles([img.path, video.path]);
    expect(files[0]).toEqual({ nome: 'foto.jpg', caminho: img.path, tipo: 'imagem', mime: 'image/jpeg' });
    expect(files[1]).toMatchObject({ nome: 'aula.mp4', tipo: 'video', duracaoSeg: 151.4, fala: 'Oi, hoje a gente vai falar de luz.' });
    expect(files[1].quadros).toHaveLength(2);
  });

  it('a execução leva os arquivos para a pasta dela (o vídeo fica onde está)', async () => {
    openDb(':memory:');
    const img = attach('foto.jpg', 'image/jpeg');
    const video = watched();
    const runDir = mkdtempSync(join(tmpdir(), 'pipo-run-'));
    const staged = stageInputFiles({ pedido: 'corta', arquivos: await inputFiles([img.path, video.path]) }, runDir) as { arquivos: Array<{ caminho: string; quadros?: string[]; leitura?: string }> };
    expect(staged.arquivos[0].caminho).toBe(join(runDir, 'entrada', '1', 'abc123-foto.jpg'));
    expect(readFileSync(staged.arquivos[0].caminho, 'utf8')).toBe('x');
    expect(staged.arquivos[1].caminho).toBe(video.path);
    expect(staged.arquivos[1].quadros?.every((q) => q.startsWith(join(runDir, 'entrada', '2')) && existsSync(q))).toBe(true);
    expect(staged.arquivos[1].leitura).toBe(join(runDir, 'entrada', '2', 'leitura.md'));
    expect(stageInputFiles({ saidas: {} }, runDir)).toEqual({ saidas: {} });
  });

  it('o passo de IA do plano vê os arquivos dentro da execução', async () => {
    openDb(':memory:');
    const img = attach('foto.jpg', 'image/jpeg');
    const p = repo.createPipo({ name: 'Editor', color: 'purple', personality: { mission: 'edito vídeos', tone: 'direto', never: [] } });
    const seen: Array<{ prompt: string; readDirs: string[] }> = [];
    const deps: Deps = {
      agent: async (o) => {
        seen.push({ prompt: o.prompt, readDirs: o.readDirs });
        return 'ok';
      },
      confirm: async () => 'yes',
      notify: () => undefined,
      gfetch: async () => {
        throw new Error('sem google');
      },
      fetch: (...a) => fetch(...a),
      handoff: async () => 'ok',
      askPipo: async () => 'ajuda',
      update: () => undefined,
    };
    const playbook: PipoPlaybook = { steps: [{ kind: 'agent', key: 'olhar', title: 'Olhar a foto', prompt: 'Pedido: {{entrada.pedido}}. Arquivo: {{entrada.arquivos.0.caminho}}' }], metrics: [], limits: { maxRunMinutes: 2, window: null } };
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'chat', playbook, input: { pedido: 'melhora a luz', arquivos: await inputFiles([img.path]) } }, deps);
    expect(run.status).toBe('done');
    expect(seen[0].prompt).toMatch(/Pedido: melhora a luz\. Arquivo: .*[\\/]runs[\\/]\d+[\\/]entrada[\\/]1[\\/]abc123-foto\.jpg/);
    expect(seen[0].prompt.includes(seen[0].readDirs[0])).toBe(true);
  });
});
