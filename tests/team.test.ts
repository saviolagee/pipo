import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePlaybook } from '../src/shared/plan-check';
import type { PipoPlaybook } from '../src/shared/pipos';
import { factKey, factsBlock } from '../src/shared/team';

const dir = mkdtempSync(join(tmpdir(), 'pipo-equipe-'));
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
// O Pipo colorido "responde" sem chamar o modelo de verdade.
const asked: Array<{ system: string; prompt: string }> = [];
vi.mock('../src/main/agent/service', async (original) => ({
  ...(await original<typeof import('../src/main/agent/service')>()),
  runRaw: async (o: { system: string; prompt: string }) => {
    asked.push(o);
    return 'Falhei ontem porque a chave do e-mail venceu.';
  },
}));

const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { execute, runnerHooks } = await import('../src/main/pipos/runner');
const { listMessages } = await import('../src/main/db/repos/conversations');
const { promptHooks } = await import('../src/main/agent/service');
const { callTool, toolDescriptors } = await import('../src/main/mcp/tools');
const facts = await import('../src/main/team/facts');
const chat = await import('../src/main/team/chat');
const { registerTeam } = await import('../src/main/team');
const { queryList } = await import('../src/main/browser/research');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const plan: PipoPlaybook = {
  steps: [{ kind: 'script', key: 'contar', title: 'Contar', command: 'node', args: ['scripts/contar.js'] }],
  metrics: [{ key: 'itens', label: 'itens', from: '{{passos.contar.saida.itens}}' }],
  limits: { maxRunMinutes: 5, window: null },
};

const deps = (): Deps => ({
  agent: async () => 'ok',
  confirm: async () => 'yes',
  notify: () => undefined,
  gfetch: async () => {
    throw new Error('sem google');
  },
  fetch: (...a) => fetch(...a),
  handoff: async () => 'ok',
  askPipo: async () => 'ajuda',
  update: () => undefined,
});

function hired(name: string, itens = 3): ReturnType<typeof repo.createPipo> {
  const p = repo.createPipo({ name, color: 'green', accessory: 'magnifier', personality: { mission: 'Encontro leads', tone: 'direto', never: [] } });
  writeFileSync(join(repo.pipoDir(p.slug), 'scripts', 'contar.js'), `const fs = require('fs'); const e = JSON.parse(fs.readFileSync(process.env.PIPO_INPUT, 'utf8')); console.log(JSON.stringify({ itens: ${itens}, pedido: e && e.pedido, contextoArquivo: !!process.env.PIPO_CONTEXT_FILE }));`);
  repo.addVersion(p.id, plan, 'v1');
  return repo.getPipo(p.id) as ReturnType<typeof repo.createPipo>;
}

beforeEach(() => {
  openDb(':memory:');
  asked.length = 0;
});

describe('memória da equipe', () => {
  it('guarda sem repetir, esquece pelo texto parecido e vira um bloco de prompt', () => {
    expect(facts.factsText()).toBe('');
    const a = facts.addFact('  Vendo consultoria financeira   para indústrias. ', 'chat');
    expect(a.text).toBe('Vendo consultoria financeira para indústrias.');
    expect(facts.addFact('vendo consultoria financeira para industrias').id).toBe(a.id);
    facts.addFact('Não trabalho às sextas', '@prospector');
    expect(facts.listFacts().map((f) => f.source)).toEqual(['chat', '@prospector']);
    expect(facts.factsText()).toContain('- Vendo consultoria financeira para indústrias.');
    expect(facts.forgetFact('esquece que não trabalho sextas')?.text).toBe('Não trabalho às sextas');
    expect(facts.forgetFact('assunto que não existe')).toBeNull();
    expect(facts.listFacts()).toHaveLength(1);
    expect(() => facts.addFact('   ')).toThrow();
    expect(factKey('Meu  negócio é X.')).toBe(factKey('meu negocio e x'));
    expect(factsBlock([])).toBe('');
  });

  it('entra nos passos de IA de todo Pipo', async () => {
    facts.addFact('O público é dono de indústria de médio porte');
    const p = repo.createPipo({ name: 'Redator', color: 'blue', personality: { mission: 'Escrevo', tone: 'leve', never: [] } });
    let system = '';
    const d = deps();
    d.agent = async (o) => {
      system = o.system;
      return 'texto';
    };
    await execute({ pipo: p, version: 1, dryRun: true, trigger: 'ensaio', playbook: { steps: [{ kind: 'agent', key: 'escrever', title: 'Escrever', prompt: 'Escreva.' }], metrics: [], limits: { maxRunMinutes: 5, window: null } } }, d);
    expect(system).toContain('O público é dono de indústria de médio porte');
  });
});

describe('chat geral da equipe', () => {
  it('é uma conversa só, e cada fala guarda quem escreveu', () => {
    const conv = chat.teamConversation();
    expect(chat.teamConversation()).toBe(conv);
    expect(chat.isTeamConversation(conv)).toBe(true);
    expect(chat.isTeamConversation(conv + 1)).toBe(false);
    const p = hired('Prospector');
    chat.postAs(p, 'Peguei a tarefa.');
    const msgs = listMessages(conv);
    expect(msgs[0].author).toBeNull();
    expect(msgs[1].author).toEqual({ name: 'Prospector', slug: 'prospector', color: '#3DDC84', accessory: 'magnifier' });
    // O autor fica na mensagem: continua lá depois que o Pipo é excluído.
    repo.deletePipo(p.id);
    expect(listMessages(conv)[1].author?.name).toBe('Prospector');
  });

  it('o prompt apresenta a equipe e a conversa recente', () => {
    const p = hired('Prospector');
    repo.createPipo({ name: 'Rascunho', color: 'pink', personality: { mission: 'ainda não contratado', tone: '', never: [] } });
    chat.postAs(p, 'Terminei. 3 itens.');
    const prompt = chat.buildTeamPrompt();
    expect(prompt).toContain('Prospector (@prospector): Encontro leads');
    expect(prompt).not.toContain('Rascunho');
    expect(prompt).toContain('Prospector: Terminei. 3 itens.');
    expect(prompt).toContain('assign_pipo');
  });

  it('a sessão do modelo recomeça uma vez por dia', async () => {
    const { getConversation, setConversationSession } = await import('../src/main/db/repos/conversations');
    const conv = chat.teamConversation();
    setConversationSession(conv, 'sessao-antiga');
    chat.refreshTeamSession(conv, new Date('2026-11-17T10:00:00'));
    expect(getConversation(conv)?.claudeSessionId).toBeNull();
    setConversationSession(conv, 'sessao-de-hoje');
    chat.refreshTeamSession(conv, new Date('2026-11-17T18:00:00'));
    expect(getConversation(conv)?.claudeSessionId).toBe('sessao-de-hoje');
  });

  it('um Pipo pega a tarefa, roda com o pedido e conta o resultado no chat', async () => {
    registerTeam();
    const p = hired('Prospector');
    // O banco de teste recomeça a cada caso; estes registros evitam repetir o número de uma execução anterior.
    for (let i = 0; i < 6; i++) repo.createRun(p.id, 1, 'ensaio', true, null, plan.steps);
    // A execução real passa pelo executor de verdade, com dependências de teste.
    const depsMod = await import('../src/main/pipos/deps');
    const spy = vi.spyOn(depsMod, 'startRun').mockImplementation(async (pipoId, opts) => {
      let id = 0;
      void execute({ pipo: repo.getPipo(pipoId) as never, version: 1, dryRun: !!opts.dryRun, trigger: opts.trigger, input: opts.input, playbook: plan }, deps(), (runId) => (id = runId));
      await new Promise((r) => setTimeout(r, 20));
      return id;
    });
    const r = await chat.assignPipo({ pipo: p, request: 'Prospecta mais 10.', wait: true, waitMs: 20_000 });
    spy.mockRestore();
    expect(r.terminou).toBe(true);
    expect(r.status).toBe('done');
    expect(r.metricas).toEqual({ itens: 3 });
    expect(r.saidas).toContain('"pedido":"Prospecta mais 10."');
    expect(r.saidas).toContain('"contextoArquivo":true');
    const texts = listMessages(chat.teamConversation()).map((m) => `${m.author?.slug ?? 'pipo'}: ${m.text}`);
    expect(texts).toContain('prospector: Peguei: Prospecta mais 10. Aviso aqui quando terminar.');
    expect(texts.some((t) => t.startsWith('prospector: Terminei. 3 itens'))).toBe(true);
    runnerHooks.finished.length = 0;
  });

  it('relata no chat só o que importa: pedido ali, falha ou resultado', () => {
    const p = hired('Prospector');
    const run = (over: Partial<import('../src/shared/pipos').PipoRun>): import('../src/shared/pipos').PipoRun => ({ id: 900 + Math.floor(Math.random() * 90), pipoId: p.id, version: 1, trigger: 'schedule', status: 'done', dryRun: false, startedAt: '', finishedAt: '', summary: 'Prospector: concluído em menos de 1 min.', metrics: {}, fromRunId: null, error: null, tokensIn: 0, tokensOut: 0, ...over });
    expect(chat.reportRun(run({}))).toBe(false);
    expect(chat.reportRun(run({ dryRun: true, status: 'failed' }))).toBe(false);
    expect(chat.reportRun(run({ metrics: { enviados: 4 }, summary: 'Prospector: 4 e-mails enviados.' }))).toBe(true);
    expect(chat.reportRun(run({ status: 'failed', error: 'Enviar: login recusado' }))).toBe(true);
    const texts = listMessages(chat.teamConversation()).map((m) => m.text);
    expect(texts).toContain('Terminei. 4 e-mails enviados.');
    expect(texts).toContain('Não consegui terminar: Enviar: login recusado');
  });

  it('ferramentas: o chat geral tem as do chat e as da equipe; o Pipo responde com o nome dele', async () => {
    registerTeam();
    const names = (mode: 'chat' | 'team' | 'pipo'): string[] => toolDescriptors({ mode, conversationId: 1 }).map((t) => t.name);
    for (const n of ['get_context', 'create_task', 'remember_fact', 'ask_pipo', 'assign_pipo', 'team_status', 'delete_pipo']) expect(names('team')).toContain(n);
    expect(names('chat')).not.toContain('assign_pipo');
    expect(names('pipo')).toContain('remember_fact');
    expect(names('pipo')).not.toContain('ask_pipo');

    const conv = chat.teamConversation();
    expect(promptHooks.modeFor?.(conv)).toEqual({ mode: 'team' });
    expect(promptHooks.modeFor?.(conv + 50)).toBeNull();

    const p = hired('Prospector');
    const run = repo.createRun(p.id, 1, 'schedule', false, null, plan.steps);
    repo.setStep(run.id, 'contar', { status: 'failed', error: '535 login recusado' });
    repo.finishRun(run.id, 'failed', { error: 'Contar: 535 login recusado' });
    facts.addFact('Atendo indústrias');
    const out = await callTool('ask_pipo', { slug: '@prospector', message: 'Por que falhou ontem?' }, { mode: 'team', conversationId: conv });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.text).resposta).toContain('a chave do e-mail venceu');
    expect(asked[0].system).toContain('o passo que quebrou foi "Contar": 535 login recusado');
    expect(asked[0].system).toContain('Atendo indústrias');
    expect(asked[0].prompt).toContain('Por que falhou ontem?');
    expect(listMessages(conv).at(-1)?.author?.slug).toBe('prospector');

    const fact = await callTool('remember_fact', { fact: 'O ticket médio é R$ 12 mil' }, { mode: 'pipo', conversationId: null, pipoId: p.id });
    expect(fact.isError).toBe(false);
    expect(facts.listFacts().at(-1)).toMatchObject({ text: 'O ticket médio é R$ 12 mil', source: '@prospector' });
    expect((await callTool('ask_pipo', { slug: 'ninguem', message: 'oi' }, { mode: 'team', conversationId: conv })).isError).toBe(true);
    expect((await callTool('ask_pipo', { slug: 'prospector', message: 'oi' }, { mode: 'chat', conversationId: 1 })).isError).toBe(true);
    runnerHooks.finished.length = 0;
  });
});

describe('pesquisa com várias buscas', () => {
  const env = { secrets: [], scripts: [], pipos: [], mcpServers: [] };
  const base = { kind: 'agent', key: 'planejar', title: 'Planejar', prompt: 'x', json: true } as const;
  const steps = (r: Record<string, unknown>): PipoPlaybook => ({ steps: [base, { kind: 'research', key: 'buscar', title: 'Buscar', query: '', ...r } as never], metrics: [], limits: { maxRunMinutes: 5, window: null } });

  it('valida "queries" e o limite de fontes por busca', () => {
    expect(validatePlaybook(steps({ queries: '{{passos.planejar.saida.consultas}}', sources: 0 }), env)).toEqual([]);
    expect(validatePlaybook(steps({}), env).map((i) => i.message)).toContain('A pesquisa precisa de "query" (o que buscar).');
    expect(validatePlaybook(steps({ queries: 'texto solto' }), env).some((i) => i.message.includes('"queries" é um template'))).toBe(true);
    expect(validatePlaybook(steps({ queries: '{{passos.planejar.saida.consultas}}', sources: 5 }), env).map((i) => i.message)).toContain('Com "queries", "sources" vai de 0 a 3 por busca.');
    expect(validatePlaybook(steps({ queries: '{{passos.nada.saida}}' }), env).some((i) => i.message.includes('não vem antes'))).toBe(true);
  });

  it('monta a lista de buscas sem repetir e com teto', () => {
    expect(queryList(['  vaga  controller ', 'vaga controller', '', { consulta: 'cfo interino' }, 7])).toEqual(['vaga controller', 'cfo interino', '7']);
    expect(queryList('uma busca só')).toEqual(['uma busca só']);
    expect(queryList(null)).toEqual([]);
    expect(queryList(Array.from({ length: 30 }, (_x, i) => `busca ${i}`))).toHaveLength(12);
  });
});
