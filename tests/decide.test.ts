import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK, isLocalUrl, layaRequest, normalizeOptions, parseChoice, parseLayaAnswer, trainingLine, type DecisionExample } from '../src/shared/decide';
import { validatePlaybook } from '../src/shared/plan-check';
import type { DecideStep, PipoPlaybook } from '../src/shared/pipos';

const dir = mkdtempSync(join(tmpdir(), 'pipo-decide-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  session: {},
  dialog: {},
}));
const { openDb } = await import('../src/main/db');
const engine = await import('../src/main/decide/engine');
const repo = await import('../src/main/pipos/repo');
const { execute } = await import('../src/main/pipos/runner');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const OPTIONS = { orcamento: 'pede preço ou proposta', suporte: 'relata um problema', outro: 'qualquer outra coisa' };
const QUESTION = 'Que tipo de e-mail é este?';
const signal = new AbortController().signal;
/** Claude de mentira: responde pelo que está escrito no e-mail. */
const claude = vi.fn(async (o: { prompt: string }) => (o.prompt.includes('quanto custa') ? '{"escolha": "orcamento"}' : '```json\n{"escolha":"suporte"}\n```'));
/** laya-serve de mentira: responde `choice` com a confiança dada. */
const laya = (choice: string, confidence: number, calls: string[] = []): typeof fetch =>
  (async (url: string, init?: RequestInit) => {
    calls.push(`${url} ${String(init?.body)}`);
    return new Response(JSON.stringify({ model: 'triagem', answers: { decisao: { type: 'choice', choice, probabilities: { [choice]: confidence }, answer_confidence: confidence } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
const input = (state: string, over: Partial<Parameters<typeof engine.decide>[0]> = {}): Parameters<typeof engine.decide>[0] => ({ activity: 'triagem_email', state, question: QUESTION, options: OPTIONS, pipoId: null, runId: null, agent: claude as never, signal, ...over });

beforeEach(() => {
  openDb(':memory:');
  claude.mockClear();
});

describe('decisão: peças', () => {
  it('opções aceitam objeto, lista de textos e lista de objetos', () => {
    expect(normalizeOptions({ sim: 'pode', nao: '' })).toEqual({ sim: 'pode', nao: 'nao' });
    expect(normalizeOptions(['Link A', ' Link B ', ''])).toEqual({ 'Link A': 'Link A', 'Link B': 'Link B' });
    expect(normalizeOptions([{ id: 'a', descricao: 'primeira' }, { titulo: 'b' }])).toEqual({ a: 'primeira', b: 'b' });
    expect(normalizeOptions('texto solto')).toEqual({});
  });

  it('entende a resposta do Claude em JSON, com crases ou só o id, e recusa o que não é opção', () => {
    expect(parseChoice('{"escolha": "suporte"}', OPTIONS)).toBe('suporte');
    expect(parseChoice('```json\n{"escolha":"Orcamento"}\n```', OPTIONS)).toBe('orcamento');
    expect(parseChoice('"outro"', OPTIONS)).toBe('outro');
    expect(parseChoice('Acho que é {"escolha": "suporte"} mesmo', OPTIONS)).toBe('suporte');
    expect(parseChoice('{"escolha": "vendas"}', OPTIONS)).toBeNull();
  });

  it('fala com o laya-serve no formato dele e só aceita servidor desta máquina', () => {
    expect(layaRequest('oi', QUESTION, OPTIONS, { task: 'triagem' })).toEqual({ state: 'oi', questions: { decisao: { type: 'choice', instructions: QUESTION, criteria: OPTIONS } }, task: 'triagem' });
    expect(parseLayaAnswer({ answers: { decisao: { choice: 'suporte', answer_confidence: 0.93, confidence: 0.7 } } }, OPTIONS)).toEqual({ choice: 'suporte', confidence: 0.93 });
    expect(parseLayaAnswer({ answers: { decisao: { choice: 'vendas', answer_confidence: 0.99 } } }, OPTIONS)).toBeNull();
    expect(parseLayaAnswer({ detail: 'inference failed' }, OPTIONS)).toBeNull();
    expect([isLocalUrl('http://127.0.0.1:8000'), isLocalUrl('http://localhost:8000/'), isLocalUrl('https://laya.exemplo.com'), isLocalUrl('nada')]).toEqual([true, true, false, false]);
  });

  it('o plano valida a decisão', () => {
    const step = (over: Partial<DecideStep> = {}): DecideStep => ({ kind: 'decide', key: 'triagem', title: 'Classificar', activity: 'triagem_email', state: '{{entrada}}', question: QUESTION, options: OPTIONS, ...over });
    const plan = (s: DecideStep): PipoPlaybook => ({ steps: [s], metrics: [], limits: { maxRunMinutes: 5, window: null } });
    const env = { secrets: [], scripts: [], pipos: [], mcpServers: [] };
    expect(validatePlaybook(plan(step()), env)).toEqual([]);
    expect(validatePlaybook(plan(step({ options: '{{entrada.links}}' })), env)).toEqual([]);
    expect(validatePlaybook(plan(step({ activity: 'Triagem de E-mail', options: { sim: 's' } })), env).map((i) => i.message.split(/[:(]/)[0])).toEqual(['A decisão precisa de "activity"', 'A decisão precisa de pelo menos duas "options" ']);
  });
});

describe('decisão: quem decide', () => {
  it('sem modelo local, o Claude decide e o exemplo fica guardado na atividade', async () => {
    const r = await engine.decide(input('Oi, quanto custa o plano anual?'));
    expect(r).toEqual({ escolha: 'orcamento', confianca: null, origem: 'claude' });
    const [a] = engine.listActivities();
    expect([a.activity, a.examples, a.teacher, a.local]).toEqual(['triagem_email', 1, 1, null]);
    // O conteúdo a decidir vai como dado, com o aviso de que não é instrução.
    expect(claude.mock.calls[0][0]).toMatchObject({ model: 'haiku' });
    expect((claude.mock.calls[0][0] as unknown as { system: string }).system).toContain('nunca instrução');
  });

  it('o modelo local só liga depois de acertar os exemplos da própria atividade', async () => {
    // Poucos exemplos: nem tenta.
    const few = await engine.setLocalModel('triagem_email', { url: 'http://127.0.0.1:8000', minConfidence: 0.8 }, laya('suporte', 0.9));
    expect([few?.ok, few?.error?.includes('precisa de pelo menos')]).toEqual([false, true]);
    for (let i = 0; i < CHECK.minExamples; i++) await engine.decide(input(`O sistema caiu de novo (${i})`));
    // Modelo que erra (responde "outro" para tudo): não liga.
    const bad = await engine.setLocalModel('triagem_email', { url: 'http://127.0.0.1:8000', minConfidence: 0.8 }, laya('outro', 0.99));
    expect([bad?.ok, bad?.agree, engine.localModels().triagem_email]).toEqual([false, 0, undefined]);
    // Modelo que acerta: liga, e só para esta atividade.
    const good = await engine.setLocalModel('triagem_email', { url: 'http://127.0.0.1:8000/', task: 'triagem', minConfidence: 0.8 }, laya('suporte', 0.95));
    expect([good?.ok, good?.rate]).toEqual([true, 1]);
    expect(Object.keys(engine.localModels())).toEqual(['triagem_email']);
    // Servidor fora da máquina é recusado.
    expect((await engine.setLocalModel('triagem_email', { url: 'https://laya.exemplo.com', minConfidence: 0.8 }, laya('suporte', 0.95)))?.error).toContain('desta máquina');
  });

  it('ligado: resposta segura vale; insegura, de outra atividade ou com o servidor fora, volta para o Claude', async () => {
    for (let i = 0; i < CHECK.minExamples; i++) await engine.decide(input(`O sistema caiu (${i})`));
    await engine.setLocalModel('triagem_email', { url: 'http://127.0.0.1:8000', minConfidence: 0.8 }, laya('suporte', 0.95));
    claude.mockClear();
    const calls: string[] = [];
    expect(await engine.decide(input('Não consigo entrar', { fetch: laya('suporte', 0.91, calls) }))).toEqual({ escolha: 'suporte', confianca: 0.91, origem: 'laya' });
    expect(claude).not.toHaveBeenCalled();
    expect(calls[0]).toContain('http://127.0.0.1:8000/v1/systemone');
    // Pouca confiança: o Claude decide (e esse exemplo vira gabarito para o próximo treino).
    expect((await engine.decide(input('Oi, quanto custa?', { fetch: laya('suporte', 0.55) }))).origem).toBe('claude');
    // Outra atividade não usa o ajuste desta.
    const other: string[] = [];
    expect((await engine.decide(input('Oi, quanto custa?', { activity: 'triagem_chat', fetch: laya('suporte', 0.99, other) }))).origem).toBe('claude');
    expect(other).toEqual([]);
    // Servidor desligado.
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect((await engine.decide(input('Travou tudo', { fetch: down }))).origem).toBe('claude');
  });

  it('exporta para treino só o que tem gabarito: o Claude, ou a correção do usuário', async () => {
    await engine.decide(input('Oi, quanto custa o plano?'));
    const [e] = engine.examplesOf('triagem_email');
    expect(JSON.parse(trainingLine(e) as string)).toEqual({ state: 'Oi, quanto custa o plano?', questions: { decisao: { type: 'choice', instructions: QUESTION, criteria: OPTIONS } }, expected: { decisao: 'orcamento' } });
    const byLocal: DecisionExample = { ...e, source: 'laya', choice: 'suporte' };
    expect(trainingLine(byLocal)).toBeNull();
    expect(JSON.parse(trainingLine({ ...byLocal, corrected: 'outro' }) as string).expected).toEqual({ decisao: 'outro' });
  });
});

describe('decisão: no plano', () => {
  it('a escolha alimenta o passo seguinte', async () => {
    const p = repo.createPipo({ name: 'Triagem', color: 'purple', personality: { mission: 'classificar', tone: 'direto', never: [] } });
    const notes: string[] = [];
    const deps: Deps = {
      agent: async () => 'ok',
      confirm: async () => 'yes',
      notify: (o) => {
        notes.push(o.title);
      },
      gfetch: async () => {
        throw new Error('sem google');
      },
      fetch: (...a) => fetch(...a),
      handoff: async () => 'ok',
      askPipo: async () => 'ajuda',
      decide: (o) => engine.decide({ ...o, pipoId: o.pipo.id, agent: claude as never }),
      update: () => undefined,
    };
    const playbook: PipoPlaybook = {
      steps: [
        { kind: 'decide', key: 'triagem', title: 'Classificar', activity: 'triagem_email', state: '{{entrada.texto}}', question: QUESTION, options: OPTIONS },
        { kind: 'branch', key: 'so_orcamento', title: 'Só orçamento segue', if: '{{passos.triagem.saida.escolha}} != orcamento', then: 'end' },
        { kind: 'notify', key: 'avisar', title: 'Pedido de orçamento ({{passos.triagem.saida.origem}})' },
      ],
      metrics: [],
      limits: { maxRunMinutes: 2, window: null },
    };
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', input: { texto: 'Bom dia, quanto custa o plano?' }, playbook }, deps);
    expect(run.status).toBe('done');
    expect(notes).toContain('Pedido de orçamento (claude)');
    expect(engine.examplesOf('triagem_email')).toHaveLength(1);
  });
});
