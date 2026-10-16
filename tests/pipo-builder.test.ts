import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describePlaybook, validatePlaybook } from '../src/shared/plan-check';
import { isCreatePipoIntent } from '../src/shared/intents';
import { PLANNING_PRINCIPLES, STEP_PRINCIPLES } from '../src/shared/pipo-principles';
import { EMPTY_PLAYBOOK, type PipoPlaybook, type PipoStep, type ResearchStep } from '../src/shared/pipos';

const dir = mkdtempSync(join(tmpdir(), 'pipo-builder-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  session: {},
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const drafts = await import('../src/main/pipos/drafts');
const { execute, pipoSystemPrompt } = await import('../src/main/pipos/runner');
const { researchQuery } = await import('../src/main/browser/research');
const { builderHooks } = await import('../src/main/pipos/builder-tools');
const { hireBlocker, hireDraft } = await import('../src/main/pipos/plan-card');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const env = { secrets: [], scripts: [], pipos: [], mcpServers: [] };
const research = (over: Partial<ResearchStep> = {}): ResearchStep => ({ kind: 'research', key: 'refs', title: 'Buscar referências', query: 'melhores Reels de comunidade', ...over });
const plan = (...steps: PipoStep[]): PipoPlaybook => ({ steps, metrics: [], limits: { maxRunMinutes: 5, window: null } });
const persona = { mission: 'cuido da comunidade', tone: 'animado', never: [] };

describe('pedido natural para criar um Pipo', () => {
  it('reconhece "quero um Pipo que…" e parecidos', () => {
    for (const ok of ['quero um pipo que poste no instagram', 'Quero criar um Pipo pra minha comunidade', 'cria um pipo que responde e-mails', 'preciso de um novo Pipo que cobre clientes', 'pipo, monta um pipo pra prospectar', 'Faça um Pipo que me avise das vendas'])
      expect(isCreatePipoIntent(ok)).toBe(true);
    for (const no of ['como eu crio um pipo?', 'quero um pipoca', 'o pipo de vendas rodou?', 'quero que você me ajude com a comunidade', '@vendas cria um relatório'])
      expect(isCreatePipoIntent(no)).toBe(false);
  });
});

describe('passo research', () => {
  it('valida a busca e a quantidade de fontes', () => {
    expect(validatePlaybook(plan(research()), env)).toEqual([]);
    expect(validatePlaybook(plan(research({ query: ' ' })), env).map((i) => i.message)).toContain('A pesquisa precisa de "query" (o que buscar).');
    expect(validatePlaybook(plan(research({ sources: 9 })), env).map((i) => i.message)).toContain('"sources" vai de 1 a 5.');
    // Um passo de IA pode usar as fontes que a pesquisa trouxe.
    const agent: PipoStep = { kind: 'agent', key: 'escrever', title: 'Escrever os posts', prompt: 'Com base em {{passos.refs.saida.fontes}}, escreva 3 posts.' };
    expect(validatePlaybook(plan(research(), agent), env)).toEqual([]);
  });

  it('aparece legível no card do plano e é só leitura', () => {
    const [line] = describePlaybook(plan(research({ sources: 2, sites: ['business.instagram.com'] })));
    expect(line.title).toBe('1. Buscar referências');
    expect(line.detail).toBe('pesquisa · "melhores Reels de comunidade" · 2 fontes em business.instagram.com');
  });

  it('os sites preferidos viram "site:" na busca', () => {
    const id = (t: string): string => t;
    expect(researchQuery({ query: 'tendências tiktok', sites: ['https://newsroom.tiktok.com/pt-br', 'later.com'] }, id)).toBe('tendências tiktok site:newsroom.tiktok.com OR site:later.com');
    expect(researchQuery({ query: '  ' }, id)).toBe('');
  });

  function deps(over: Partial<Deps> = {}): Deps & { prompts: string[] } {
    const prompts: string[] = [];
    return {
      prompts,
      agent: async (o) => {
        prompts.push(o.prompt);
        return 'posts prontos';
      },
      confirm: async () => 'yes',
      notify: () => undefined,
      gfetch: async () => {
        throw new Error('sem google');
      },
      fetch: (...a) => fetch(...a),
      handoff: async () => 'ok',
      askPipo: async () => 'ajuda',
      research: async (s) => ({ consulta: s.query, fontes: [{ titulo: 'Guia oficial', url: 'https://business.instagram.com/guia', trecho: '', texto: 'Reels curtos com gancho nos 3 primeiros segundos.' }] }),
      update: () => undefined,
      ...over,
    };
  }

  it('as fontes alimentam o passo de IA, até no ensaio', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Comunidade', color: 'pink', personality: persona });
    const d = deps();
    const playbook = plan(research(), { kind: 'agent', key: 'escrever', title: 'Escrever', prompt: 'Fontes: {{passos.refs.saida.fontes | json}}' });
    const run = await execute({ pipo: p, version: 1, dryRun: true, trigger: 'rehearsal', playbook }, d);
    expect(run.status).toBe('done');
    expect(d.prompts[0]).toContain('gancho nos 3 primeiros segundos');
  });

  it('sem navegador, a pesquisa falha com uma mensagem clara', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Sem web', color: 'red', personality: persona });
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook: plan(research()) }, deps({ research: undefined }));
    expect(run.status).toBe('failed');
    expect(run.error).toContain('pesquisa na web não está disponível');
  });
});

describe('pré-conhecimentos de todo Pipo', () => {
  it('o construtor planeja até o objetivo final e pesquisa antes de marketing', () => {
    expect(PLANNING_PRINCIPLES).toMatch(/objetivo final/);
    expect(PLANNING_PRINCIPLES).toMatch(/referências validadas/);
    expect(PLANNING_PRINCIPLES).toMatch(/API oficial/);
  });

  it('os passos de IA recebem o princípio do trabalho completo', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Escritor', color: 'blue', personality: persona });
    expect(pipoSystemPrompt(p, [], false)).toContain(STEP_PRINCIPLES);
  });
});

describe('botão Contratar no card do plano', () => {
  it('só libera com o ensaio passando; contratar fixa a versão e fecha o rascunho', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Avisador', color: 'green', personality: persona });
    const steps: PipoStep[] = [{ kind: 'notify', key: 'avisar', title: 'Avisar', body: 'oi' }];
    let d = drafts.createDraft(null, { pipoId: p.id, plan: { ...EMPTY_PLAYBOOK, steps } });
    expect(hireBlocker(d)).toBe('falta um ensaio que passe');
    d = drafts.updateDraft(d.id, { data: { rehearsal: { runId: 1, ok: true }, intro: 'Oi, eu aviso você.' } });
    expect(hireBlocker(d)).toBeNull();
    const intro = vi.fn();
    builderHooks.introduce = intro;
    const r = hireDraft(d);
    expect(r).toMatchObject({ versao: 1, slug: 'avisador' });
    expect(repo.activePlaybook(p.id)?.playbook.steps.map((s) => s.key)).toEqual(['avisar']);
    expect(drafts.openDrafts()).toHaveLength(0);
    expect(intro).toHaveBeenCalledWith(p.id, 'Oi, eu aviso você.');
  });

  it('plano com erro não contrata, mesmo com ensaio antigo', () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Quebrado', color: 'red', personality: persona });
    const d = drafts.createDraft(null, { pipoId: p.id, plan: plan(research({ query: '' })), rehearsal: { runId: 1, ok: true } });
    expect(hireBlocker(d)).toMatch(/^o plano tem um problema: refs: A pesquisa precisa/);
  });
});
