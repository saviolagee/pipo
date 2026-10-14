import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWN } from '../src/shared/decide';
import { crossValidate, pickThreshold, predict, trainSoftmax } from '../src/shared/softmax';

const dir = mkdtempSync(join(tmpdir(), 'pipo-own-'));
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
const own = await import('../src/main/decide/own');
const { importExamples } = await import('../src/main/decide');

/** Modelo de leitura de mentira: cada palavra tem a sua posição no vetor (saco de palavras). */
const DIM = 64;
const vocab = new Map<string, number>();
function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const word of text.toLowerCase().match(/[a-zà-ú]+/g) ?? []) {
    if (!vocab.has(word)) vocab.set(word, vocab.size % DIM);
    v[vocab.get(word) as number] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
const calls: string[][] = [];
const embed = async (texts: string[]): Promise<Float32Array[]> => {
  calls.push(texts);
  return texts.map(fakeVector);
};

const OPTIONS = { orcamento: 'pede preço ou proposta', suporte: 'relata um problema', outro: 'qualquer outra coisa' };
const QUESTION = 'Que tipo de e-mail é este?';
/** Palavras típicas de cada resposta; cada exemplo junta três delas com duas palavras comuns. */
const WORDS: Record<keyof typeof OPTIONS, string[]> = {
  orcamento: ['preço', 'valor', 'orçamento', 'cotação', 'proposta', 'plano', 'custa', 'desconto'],
  suporte: ['erro', 'sistema', 'travou', 'caiu', 'login', 'senha', 'nota', 'carrega'],
  outro: ['festa', 'almoço', 'convite', 'parabéns', 'equipe', 'aniversário', 'reunião', 'obrigado'],
};
const FILLER = ['bom', 'dia', 'por', 'favor', 'hoje', 'aqui', 'muito', 'agora'];
const sample = (label: keyof typeof OPTIONS, i: number): string => [WORDS[label][i % 8], FILLER[i % 8], WORDS[label][(i * 3 + 1) % 8], FILLER[(i * 5 + 3) % 8], WORDS[label][(i * 5 + 2) % 8]].join(' ');
const PER_LABEL = 12;
const BUDGET = Array.from({ length: PER_LABEL }, (_, i) => sample('orcamento', i));
const signal = new AbortController().signal;
const claude = vi.fn(async (o: { prompt: string }) => {
  const text = o.prompt.split('Conteúdo a decidir:\n')[1] ?? '';
  const pick = WORDS.orcamento.some((w) => text.includes(w)) ? 'orcamento' : WORDS.suporte.some((w) => text.includes(w)) ? 'suporte' : 'outro';
  return JSON.stringify({ escolha: pick });
});
const input = (state: string): Parameters<typeof engine.decide>[0] => ({ activity: 'triagem_email', state, question: QUESTION, options: OPTIONS, pipoId: null, runId: null, agent: claude as never, signal, embed });
const seed = (): number =>
  importExamples(
    'triagem_email',
    (Object.keys(OPTIONS) as Array<keyof typeof OPTIONS>)
      .flatMap((resposta) => Array.from({ length: PER_LABEL }, (_, i) => JSON.stringify({ texto: sample(resposta, i), resposta, pergunta: QUESTION, opcoes: OPTIONS })))
      .join('\n'),
  );

beforeEach(() => {
  openDb(':memory:');
  claude.mockClear();
  calls.length = 0;
});

describe('classificador (camada de decisão)', () => {
  const points = (cx: number, cy: number, n: number): Float32Array[] => Array.from({ length: n }, (_, i) => new Float32Array([cx + Math.cos(i) * 0.3, cy + Math.sin(i * 1.7) * 0.3, 1]));
  const xs = [...points(0, 0, 20), ...points(3, 0, 20), ...points(0, 3, 6)];
  const y = [...Array<number>(20).fill(0), ...Array<number>(20).fill(1), ...Array<number>(6).fill(2)];
  const labels = ['a', 'b', 'c'];

  it('aprende a separar as classes, inclusive a rara', () => {
    const model = trainSoftmax(xs, y, labels);
    expect(predict(model, new Float32Array([0.1, -0.1, 1])).label).toBe('a');
    expect(predict(model, new Float32Array([2.9, 0.2, 1])).label).toBe('b');
    const rare = predict(model, new Float32Array([0.1, 3.1, 1]));
    expect([rare.label, rare.confidence > 0.6]).toEqual(['c', true]);
    expect(rare.probs.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 5);
  });

  it('a prova usa exemplos que ficaram fora do treino e dá sempre o mesmo resultado', () => {
    const held = crossValidate(xs, y, labels);
    expect(held).toHaveLength(xs.length);
    expect(held.filter((h) => h.correct).length / held.length).toBeGreaterThan(0.95);
    expect(crossValidate(xs, y, labels)).toEqual(held);
  });

  it('escolhe a menor confiança com que o acerto passa da meta; se nenhuma serve, não libera', () => {
    const held = [
      ...Array.from({ length: 8 }, () => ({ correct: true, confidence: 0.9 })),
      { correct: false, confidence: 0.55 },
      { correct: false, confidence: 0.58 },
    ];
    const picked = pickThreshold(held, 0.92, 0.3);
    expect([picked?.threshold, picked?.accuracy, picked?.coverage]).toEqual([0.6, 1, 0.8]);
    expect(pickThreshold(held.map((h) => ({ ...h, correct: false })), 0.92, 0.3)).toBeNull();
  });
});

describe('modelo local do Pipo', () => {
  it('importa exemplos com gabarito e ignora linhas que não servem', () => {
    expect(seed()).toBe(36);
    expect(importExamples('triagem_email', 'isto não é json\n{"texto":"x","resposta":"vendas","opcoes":{"a":"1","b":"2"}}\n')).toBe(0);
    const [a] = engine.listActivities();
    expect([a.examples, a.teacher, a.fixedOptions, a.own]).toEqual([36, 36, true, null]);
  });

  it('com poucos exemplos, ou com opções que mudam a cada decisão, não treina', async () => {
    importExamples('pouca', BUDGET.slice(0, 5).map((texto) => JSON.stringify({ texto, resposta: 'orcamento', opcoes: OPTIONS })).join('\n'));
    expect((await own.trainOwn('pouca', engine.examplesOf('pouca'), embed)).error).toContain(`pelo menos ${OWN.minExamples}`);
    importExamples('links', Array.from({ length: 30 }, (_, i) => JSON.stringify({ texto: `página ${i}`, resposta: `Link ${i}`, opcoes: [`Link ${i}`, `Outro ${i}`] })).join('\n'));
    expect((await own.trainOwn('links', engine.examplesOf('links'), embed)).error).toContain('mudam de uma decisão para outra');
    expect(engine.listActivities().find((a) => a.activity === 'links')?.fixedOptions).toBe(false);
  });

  it('treina, passa na prova e responde sozinho; na dúvida devolve para o Claude', async () => {
    seed();
    const report = await own.trainOwn('triagem_email', engine.examplesOf('triagem_email'), embed);
    expect([report.ok, report.total, report.accuracy >= OWN.target, report.coverage >= OWN.minCoverage]).toEqual([true, 36, true, true]);
    // Os vetores dos exemplos ficam guardados: treinar de novo não lê os textos outra vez.
    calls.length = 0;
    await own.trainOwn('triagem_email', engine.examplesOf('triagem_email'), embed);
    expect(calls).toEqual([]);

    const sure = await engine.decide(input('preço hoje valor por favor proposta'));
    expect([sure.escolha, sure.origem, (sure.confianca ?? 0) > 0.5]).toEqual(['orcamento', 'pipo', true]);
    expect(claude).not.toHaveBeenCalled();
    // Texto que não parece com nada do treino: confiança baixa, quem decide é o Claude.
    const unsure = await engine.decide(input('zzz qqq www'));
    expect(unsure.origem).toBe('claude');
    // Mesma atividade com outras opções: o modelo não se aplica.
    claude.mockResolvedValueOnce('{"escolha":"sim"}');
    const other = await engine.decide({ ...input('preço valor plano'), options: { sim: 'sim', nao: 'não' } });
    expect(other.origem).toBe('claude');
  });

  it('sem o modelo de leitura (ou se ele falha), o Claude decide', async () => {
    seed();
    await own.trainOwn('triagem_email', engine.examplesOf('triagem_email'), embed);
    const broken = async (): Promise<Float32Array[]> => {
      throw new Error('worker fora do ar');
    };
    expect((await engine.decide({ ...input('preço valor plano'), embed: broken })).origem).toBe('claude');
    expect((await engine.decide({ ...input('preço valor plano'), embed: undefined })).origem).toBe('claude');
  });

  it('treina de novo a cada tantas decisões do Claude; se o acerto cair, pausa', async () => {
    seed();
    await own.trainOwn('triagem_email', engine.examplesOf('triagem_email'), embed);
    const before = own.ownInfo('triagem_email');
    let last: Promise<unknown> | null = null;
    for (let i = 0; i < OWN.retrainEvery; i++) last = own.learnFrom('triagem_email', () => engine.examplesOf('triagem_email'), embed) ?? last;
    await last;
    // Na quinta decisão nova o treino roda de novo e ele continua valendo.
    expect(last).not.toBeNull();
    expect([before?.enabled, own.ownInfo('triagem_email')?.enabled, own.ownInfo('triagem_email')?.trainedOn]).toEqual([true, true, 36]);

    // Gabaritos que contradizem tudo o que ele sabia: na prova nova ele não passa e para de responder.
    importExamples('triagem_email', [...BUDGET, ...BUDGET, ...BUDGET].map((texto, i) => JSON.stringify({ texto: `${texto} ${i}`, resposta: i % 2 ? 'suporte' : 'outro', pergunta: QUESTION, opcoes: OPTIONS })).join('\n'));
    const report = await own.trainOwn('triagem_email', engine.examplesOf('triagem_email'), embed);
    expect(report.ok).toBe(false);
    const info = own.ownInfo('triagem_email');
    expect([info?.enabled, typeof info?.paused]).toEqual([false, 'string']);
    expect((await engine.decide(input('preço valor proposta'))).origem).toBe('claude');

    own.removeOwn('triagem_email');
    expect(own.ownInfo('triagem_email')).toBeNull();
  });
});
