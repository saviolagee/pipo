// Modelo local do próprio Pipo: um classificador pequeno por atividade, treinado dentro do app
// (na CPU, sem Python nem placa de vídeo) com os exemplos daquela atividade. Só responde depois de
// passar na prova, e treina de novo sozinho conforme chegam exemplos novos.
import { OWN, teacherChoice, type DecisionExample, type OwnModelInfo, type OwnReport } from '@shared/decide';
import { crossValidate, pickThreshold, predict, trainSoftmax, type SoftmaxModel } from '@shared/softmax';
import { db } from '../db';
import { getKV, setKV } from '../db/repos/settings';
import type { Embedder } from './embedder';

const KV = 'decide:own';
const MAX_TEXT = 1500;
const BATCH = 8;
const ANSWER_TIMEOUT_MS = 4000;

interface Packed {
  labels: string[];
  dim: number;
  scale: number;
  mean: string;
  w: string;
  b: string;
}

interface Stored extends OwnModelInfo {
  model: Packed;
  /** Gabaritos novos desde o último treino. */
  pending: number;
}

const b64 = (a: Float32Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const f32 = (s: string): Float32Array => {
  const buf = Buffer.from(s, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const pack = (m: SoftmaxModel): Packed => ({ labels: m.labels, dim: m.dim, scale: m.scale, mean: b64(m.mean), w: b64(m.w), b: b64(m.b) });
const unpack = (p: Packed): SoftmaxModel => ({ labels: p.labels, dim: p.dim, scale: p.scale, mean: f32(p.mean), w: f32(p.w), b: f32(p.b) });

function all(): Record<string, Stored> {
  return getKV<Record<string, Stored>>(KV, {});
}

export function ownInfo(activity: string): OwnModelInfo | null {
  const s = all()[activity];
  if (!s) return null;
  const { model: _model, pending: _pending, ...info } = s;
  return info;
}

export function removeOwn(activity: string): void {
  const m = all();
  delete m[activity];
  setKV(KV, m);
}

/** As opções da atividade, se forem sempre as mesmas; null se mudam de uma decisão para outra. */
export function fixedLabels(examples: Array<Pick<DecisionExample, 'options'>>): string[] | null {
  if (!examples.length) return null;
  const first = Object.keys(examples[0].options).sort();
  const key = first.join('\u0000');
  return examples.every((e) => Object.keys(e.options).sort().join('\u0000') === key) ? first : null;
}

/** Vetores dos exemplos: lê do banco os que já existem e pede ao modelo de leitura os que faltam. */
async function vectorsOf(examples: DecisionExample[], embed: Embedder): Promise<Float32Array[]> {
  const have = new Map<number, Float32Array>();
  const ids = examples.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    for (const r of db().all<{ id: number; embedding: Uint8Array | null }>(`SELECT id, embedding FROM decisions WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) {
      if (r.embedding?.byteLength) have.set(r.id, new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength)));
    }
  }
  const missing = examples.filter((e) => !have.has(e.id));
  for (let i = 0; i < missing.length; i += BATCH) {
    const part = missing.slice(i, i + BATCH);
    const vectors = await embed(part.map((e) => e.state.slice(0, MAX_TEXT)));
    part.forEach((e, j) => {
      have.set(e.id, vectors[j]);
      db().run('UPDATE decisions SET embedding = ? WHERE id = ?', new Uint8Array(vectors[j].buffer, vectors[j].byteOffset, vectors[j].byteLength), e.id);
    });
  }
  return examples.map((e) => have.get(e.id) as Float32Array);
}

const fail = (error: string, total = 0, accuracy = 0, coverage = 0): OwnReport => ({ ok: false, total, accuracy, coverage, threshold: 0, error });

/**
 * Treina o modelo da atividade com os exemplos dela e faz a prova (com exemplos que ficam fora do
 * treino). Só passa a valer se acertar o bastante; se já havia um modelo e o novo não passa, ele pausa.
 */
export async function trainOwn(activity: string, examples: DecisionExample[], embed: Embedder): Promise<OwnReport> {
  const teacher = examples.filter((e) => teacherChoice(e)).slice(0, OWN.maxTrain);
  const stop = (r: OwnReport): OwnReport => {
    const m = all();
    // Um modelo que já existia para de responder até passar na prova de novo.
    if (m[activity]) {
      m[activity] = { ...m[activity], enabled: false, paused: r.error, pending: 0 };
      setKV(KV, m);
    }
    return r;
  };
  if (teacher.length < OWN.minExamples) return stop(fail(`Esta atividade tem ${teacher.length} exemplos com gabarito; o modelo do Pipo precisa de pelo menos ${OWN.minExamples}.`, teacher.length));
  const labels = fixedLabels(teacher);
  if (!labels) return stop(fail('As opções desta atividade mudam de uma decisão para outra (uma lista de links, por exemplo): não dá para treinar. Ela continua com o Claude.', teacher.length));
  const y = teacher.map((e) => labels.indexOf(teacherChoice(e) as string));
  if (y.some((c) => c < 0)) return stop(fail('Há exemplos com resposta fora das opções.', teacher.length));
  const counts = labels.map((_, c) => y.filter((v) => v === c).length);
  if (counts.filter((c) => c >= OWN.minPerLabel).length < 2) return stop(fail(`Quase todos os exemplos têm a mesma resposta. Precisa de pelo menos ${OWN.minPerLabel} exemplos de duas respostas diferentes.`, teacher.length));

  const xs = await vectorsOf(teacher, embed);
  const held = crossValidate(xs, y, labels);
  const picked = pickThreshold(held, OWN.target, OWN.minCoverage);
  if (!picked) {
    const right = held.filter((h) => h.correct).length / held.length;
    return stop(fail(`Na prova ele acertou ${Math.round(right * 100)}% e precisa de ${Math.round(OWN.target * 100)}% nas que responde. Continua com o Claude; mais exemplos ajudam.`, teacher.length, right, 1));
  }
  const m = all();
  m[activity] = { enabled: true, accuracy: picked.accuracy, coverage: picked.coverage, threshold: picked.threshold, trainedOn: teacher.length, trainedAt: new Date().toISOString(), paused: null, model: pack(trainSoftmax(xs, y, labels)), pending: 0 };
  setKV(KV, m);
  return { ok: true, total: teacher.length, accuracy: picked.accuracy, coverage: picked.coverage, threshold: picked.threshold, error: null };
}

/** Resposta do modelo da atividade, ou null quando ele não existe, não se aplica ou não tem certeza. */
export async function askOwn(activity: string, state: string, options: Record<string, string>, embed: Embedder): Promise<{ choice: string; confidence: number } | null> {
  const s = all()[activity];
  if (!s?.enabled) return null;
  const ids = Object.keys(options).sort();
  if (ids.length !== s.model.labels.length || ids.some((id, i) => id !== s.model.labels[i])) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS));
  const vectors = await Promise.race([embed([state.slice(0, MAX_TEXT)]).catch(() => null), timeout]);
  if (!vectors?.[0]) return null;
  const p = predict(unpack(s.model), vectors[0]);
  return p.confidence >= s.threshold ? { choice: p.label, confidence: p.confidence } : null;
}

/**
 * O Claude acabou de decidir por esta atividade (mais um gabarito). De tantos em tantos, o modelo
 * treina de novo com tudo o que aprendeu. Devolve a promessa do treino, se disparou um.
 */
export function learnFrom(activity: string, examples: () => DecisionExample[], embed: Embedder): Promise<OwnReport> | null {
  const m = all();
  const s = m[activity];
  if (!s) return null;
  s.pending = (s.pending ?? 0) + 1;
  setKV(KV, m);
  if (s.pending < OWN.retrainEvery) return null;
  return trainOwn(activity, examples(), embed).catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
