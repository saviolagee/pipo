import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseCandidate, parseComposition, shouldImprove } from '../src/shared/improve';
import type { PipoPlaybook } from '../src/shared/pipos';

const dir = mkdtempSync(join(tmpdir(), 'pipo-aprimorar-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  nativeImage: { createFromBuffer: () => ({}) },
  Notification: class {},
  BrowserWindow: class {},
  screen: {},
  dialog: {},
  shell: {},
  protocol: {},
  powerMonitor: {},
  session: {},
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { improvePipo, decideImprovement, candidateProblem } = await import('../src/main/pipos/improve');
const { improveSignals } = await import('../src/main/pipos/improve/evidence');
const { listLessons, lessonsText } = await import('../src/main/pipos/improve/store');
type Deps = import('../src/main/pipos/improve').ImproveDeps;

const base: PipoPlaybook = {
  steps: [
    { kind: 'agent', key: 'escrever', title: 'Escrever o post', prompt: 'Escreva um post sobre {{entrada.tema}}.' },
    { kind: 'notify', key: 'avisar', title: 'Avisar', body: 'Pronto' },
  ],
  metrics: [],
  limits: { maxRunMinutes: 15, window: null },
};
const better: PipoPlaybook = { ...base, steps: [{ ...base.steps[0], prompt: 'Escreva um post curto (até 120 palavras) sobre {{entrada.tema}}, com um gancho na primeira linha.' } as PipoPlaybook['steps'][number], base.steps[1]] };
const env = { secrets: [], scripts: [], pipos: [], mcpServers: [] };

/** Um Pipo contratado com uma execução real que falhou no passo de escrever. */
function setup(): ReturnType<typeof repo.createPipo> {
  openDb(':memory:');
  const p = repo.createPipo({ name: 'Escritor', color: 'blue', personality: { mission: 'Escrevo posts', tone: 'leve', never: [] } });
  repo.addVersion(p.id, base, 'primeira versão');
  const run = repo.createRun(p.id, 1, 'manual', false, null, base.steps);
  repo.setStep(run.id, 'escrever', { status: 'failed', error: 'O texto passou do limite do Instagram.' });
  repo.finishRun(run.id, 'failed', { error: 'Escrever o post: O texto passou do limite do Instagram.' });
  const runDir = join(repo.pipoDir(p.slug), 'runs', String(run.id));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, '_entrada.json'), JSON.stringify({ tema: 'fotografia de rua' }));
  return p;
}

const geralOk = JSON.stringify({ manter: false, plano: better, regras: ['Posts com até 120 palavras.'], mudancas: [{ mudanca: 'Limitar o post a 120 palavras', porque: 'o texto longo falhou', evidencia: 'escrever: passou do limite' }] });
const composed = JSON.stringify({
  decisao: 'geral',
  plano: better,
  regras: ['Posts com até 120 palavras.'],
  mudancas: [{ mudanca: 'Limitar o post a 120 palavras', porque: 'o ensaio da candidata coube no limite', evidencia: 'escrever: falhou na referência, passou no ensaio' }],
  efeitos: [{ mudanca: 'Limitar o post a 120 palavras', veredito: 'ajudou', observado: 'o ensaio passou' }],
  licao: { situacao: 'o Pipo escreve para redes sociais', licao: 'diga o limite de tamanho no texto do passo', evidencia: 'falhou sem limite, passou com limite', confianca: 'alta' },
});

function deps(answers: { geral: string[]; assunto: string[]; compor: string[] }, rehearsals: Array<'done' | 'failed'> = []): Deps & { prompts: string[] } {
  const prompts: string[] = [];
  let r = 0;
  return {
    prompts,
    ask: async (system, prompt) => {
      prompts.push(prompt);
      const list = system.includes('Seu foco: COMO') ? answers.geral : system.includes('Seu foco: O QUE') ? answers.assunto : answers.compor;
      return list.shift() ?? '{"manter": true}';
    },
    rehearse: async (_p, playbook) => {
      const status = rehearsals[r++] ?? 'done';
      return { status, error: status === 'done' ? null : 'quebrou', steps: playbook.steps.map((s) => ({ key: s.key, title: s.title, status, preview: 'ok', error: null })) };
    },
  };
}

describe('regras do aprimoramento', () => {
  it('só estuda com motivo e no máximo a cada 20 horas', () => {
    const calm = { lastStatus: 'done' as const, refused: false, skipped: 0, newRules: 0, runsSinceAttempt: 1, hoursSinceAttempt: null, pending: false };
    expect(shouldImprove(calm)).toBe(false);
    expect(shouldImprove({ ...calm, lastStatus: 'failed' })).toBe(true);
    expect(shouldImprove({ ...calm, skipped: 2 })).toBe(true);
    expect(shouldImprove({ ...calm, runsSinceAttempt: 5 })).toBe(true);
    expect(shouldImprove({ ...calm, lastStatus: 'failed', hoursSinceAttempt: 3 })).toBe(false);
    expect(shouldImprove({ ...calm, lastStatus: 'failed', pending: true })).toBe(false);
  });

  it('lê as respostas do modelo e exige evidência em cada mudança', () => {
    expect(parseCandidate('```json\n{"manter": true, "motivo": "tudo certo"}\n```')).toMatchObject({ manter: true, motivo: 'tudo certo' });
    expect(parseCandidate(geralOk).mudancas[0].evidencia).toBe('escrever: passou do limite');
    expect(() => parseCandidate(JSON.stringify({ manter: false, plano: better, mudancas: [{ mudanca: 'x', porque: 'y' }] }))).toThrow(/evidencia/);
    expect(parseComposition(composed)).toMatchObject({ decisao: 'geral', licao: { confianca: 'alta' } });
  });

  it('melhoria não pode tirar a confirmação de uma ação externa nem usar script que não existe', () => {
    const external: PipoPlaybook = { ...base, steps: [{ kind: 'confirm', key: 'ok', title: 'Confirmar', message: 'Posso?' }, { kind: 'http', key: 'postar', title: 'Postar', method: 'POST', url: 'https://api.exemplo.com/post', external: true }] };
    expect(candidateProblem(better, base, env)).toBeNull();
    expect(candidateProblem({ ...external, steps: [external.steps[1]] }, external, env)).toMatch(/sem um passo de confirmação/);
    expect(candidateProblem({ ...base, steps: [...base.steps, { kind: 'script', key: 'novo', title: 'Novo', command: 'node', args: ['scripts/novo.js'] }] }, base, env)).toMatch(/ainda não existe/);
  });
});

describe('Pipo que se aprimora', () => {
  it('a execução que falhou vira sugestão com evidência; aplicar cria a versão nova e a regra', async () => {
    const p = setup();
    const run = repo.lastRun(p.id) as NonNullable<ReturnType<typeof repo.lastRun>>;
    expect(improveSignals(p, run)).toMatchObject({ lastStatus: 'failed', pending: false, hoursSinceAttempt: null });
    const d = deps({ geral: [geralOk], assunto: ['{"manter": true, "motivo": "o tema está bom"}'], compor: [composed] });
    const imp = await improvePipo(p.id, d);
    expect(imp.status).toBe('pending');
    expect(imp.changes[0].mudanca).toBe('Limitar o post a 120 palavras');
    // O estudo leu a execução real, com o erro e a entrada.
    expect(d.prompts[0]).toContain('O texto passou do limite do Instagram.');
    expect(d.prompts[0]).toContain('fotografia de rua');
    // A lição com evidência foi para a biblioteca (e o construtor passa a ver).
    expect(listLessons()[0]).toMatchObject({ lesson: 'diga o limite de tamanho no texto do passo', confidence: 'alta' });
    expect(lessonsText()).toContain('Quando o Pipo escreve para redes sociais');
    expect(improveSignals(p, run).pending).toBe(true);
    const done = decideImprovement(imp.id, 'apply');
    expect(done.status).toBe('applied');
    const v = repo.activePlaybook(p.id);
    expect(v?.version).toBe(2);
    expect((v?.playbook.steps[0] as { prompt: string }).prompt).toContain('até 120 palavras');
    expect(repo.listMemory(p.id).map((m) => m.rule)).toEqual(['Posts com até 120 palavras.']);
    expect(() => decideImprovement(imp.id, 'apply')).toThrow(/não está mais pendente/);
  });

  it('sem evidência, mantém o plano; resposta recusada ganha uma segunda chance', async () => {
    const p = setup();
    expect((await improvePipo(p.id, deps({ geral: ['{"manter": true}'], assunto: ['{"manter": true}'], compor: [] }))).status).toBe('kept');
    const d = deps({ geral: [JSON.stringify({ manter: false, plano: better, mudancas: [{ mudanca: 'x', porque: 'y' }] }), geralOk], assunto: [], compor: [composed] });
    const imp = await improvePipo(p.id, d);
    expect(imp.status).toBe('pending');
    expect(d.prompts.some((x) => x.includes('Sua resposta anterior foi recusada') && x.includes('evidencia'))).toBe(true);
  });

  it('se a versão juntada falha no ensaio e a atual passava, não sugere nada', async () => {
    const p = setup();
    // Ensaios: atual (passa), candidata (passa), junção (falha).
    const imp = await improvePipo(p.id, deps({ geral: [geralOk], assunto: [], compor: [composed] }, ['done', 'done', 'failed']));
    expect(imp.status).toBe('kept');
    expect(imp.note).toMatch(/falhou no ensaio/);
  });

  it('sem execução de verdade, pede para rodar antes', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Novo', color: 'green', personality: { mission: '', tone: '', never: [] } });
    repo.addVersion(p.id, base, 'v1');
    await expect(improvePipo(p.id, deps({ geral: [], assunto: [], compor: [] }))).rejects.toThrow(/de verdade/);
  });
});
