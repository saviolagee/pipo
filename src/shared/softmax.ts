// Classificador pequeno (regressão logística de várias classes) treinado em cima dos "vetores" que
// um modelo de leitura de texto devolve. É a camada de decisão do modelo local do Pipo: uma por
// atividade, treinada só com os exemplos dela. Tudo puro e determinístico (tests/softmax.test.ts).

export interface SoftmaxModel {
  labels: string[];
  dim: number;
  /** Média dos vetores de treino (os vetores são centrados antes de classificar). */
  mean: Float32Array;
  scale: number;
  /** Pesos: uma linha de `dim` números por rótulo. */
  w: Float32Array;
  b: Float32Array;
}

export interface Prediction {
  label: string;
  confidence: number;
  probs: number[];
}

export interface TrainOptions {
  epochs?: number;
  lr?: number;
  l2?: number;
}

function center(xs: Float32Array[]): { mean: Float32Array; scale: number } {
  const dim = xs[0].length;
  const mean = new Float32Array(dim);
  for (const x of xs) for (let j = 0; j < dim; j++) mean[j] += x[j] / xs.length;
  let energy = 0;
  for (const x of xs) for (let j = 0; j < dim; j++) energy += (x[j] - mean[j]) ** 2;
  // Deixa os vetores centrados com tamanho médio 1: o treino converge igual para qualquer modelo de texto.
  const scale = 1 / Math.max(1e-6, Math.sqrt(energy / xs.length));
  return { mean, scale };
}

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const sum = e.reduce((a, v) => a + v, 0);
  return e.map((v) => v / sum);
}

function logits(model: Pick<SoftmaxModel, 'dim' | 'mean' | 'scale' | 'w' | 'b'>, x: Float32Array, classes: number): number[] {
  const z = new Array<number>(classes).fill(0);
  for (let c = 0; c < classes; c++) {
    let acc = model.b[c];
    const row = c * model.dim;
    for (let j = 0; j < model.dim; j++) acc += model.w[row + j] * (x[j] - model.mean[j]) * model.scale;
    z[c] = acc;
  }
  return z;
}

/** Treina com descida de gradiente (lote inteiro). `y[i]` é o índice do rótulo de `xs[i]`. */
export function trainSoftmax(xs: Float32Array[], y: number[], labels: string[], o: TrainOptions = {}): SoftmaxModel {
  if (!xs.length || xs.length !== y.length) throw new Error('Sem exemplos para treinar.');
  const { epochs = 220, lr = 2, l2 = 0.002 } = o;
  const dim = xs[0].length;
  const k = labels.length;
  const n = xs.length;
  const { mean, scale } = center(xs);
  const feats = xs.map((x) => {
    const f = new Float32Array(dim);
    for (let j = 0; j < dim; j++) f[j] = (x[j] - mean[j]) * scale;
    return f;
  });
  const w = new Float32Array(k * dim);
  const b = new Float32Array(k);
  const gw = new Float32Array(k * dim);
  const gb = new Float32Array(k);
  // Rótulo raro pesa mais: 3 exemplos de "outro" não somem diante de 40 de "suporte".
  const count = new Array<number>(k).fill(0);
  for (const c of y) count[c]++;
  const weight = count.map((c) => (c ? n / (k * c) : 0));
  for (let epoch = 0; epoch < epochs; epoch++) {
    gw.fill(0);
    gb.fill(0);
    for (let i = 0; i < n; i++) {
      const f = feats[i];
      const z = new Array<number>(k);
      for (let c = 0; c < k; c++) {
        let acc = b[c];
        const row = c * dim;
        for (let j = 0; j < dim; j++) acc += w[row + j] * f[j];
        z[c] = acc;
      }
      const p = softmax(z);
      for (let c = 0; c < k; c++) {
        const g = ((p[c] - (y[i] === c ? 1 : 0)) * weight[y[i]]) / n;
        if (g === 0) continue;
        gb[c] += g;
        const row = c * dim;
        for (let j = 0; j < dim; j++) gw[row + j] += g * f[j];
      }
    }
    const step = lr / (1 + epoch / 120);
    for (let i = 0; i < w.length; i++) w[i] -= step * (gw[i] + l2 * w[i]);
    for (let c = 0; c < k; c++) b[c] -= step * gb[c];
  }
  return { labels, dim, mean, scale, w, b };
}

export function predict(model: SoftmaxModel, x: Float32Array): Prediction {
  const probs = softmax(logits(model, x, model.labels.length));
  let best = 0;
  for (let c = 1; c < probs.length; c++) if (probs[c] > probs[best]) best = c;
  return { label: model.labels[best], confidence: probs[best], probs };
}

/** Embaralha sempre do mesmo jeito (a conferência não pode mudar de resultado a cada clique). */
function shuffled(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = 12345;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export interface HeldOut {
  correct: boolean;
  confidence: number;
}

/**
 * Prova de verdade: treina com uma parte dos exemplos e pergunta os que ficaram de fora, em
 * `folds` rodadas. Devolve, para cada exemplo, se acertou e com que confiança.
 */
export function crossValidate(xs: Float32Array[], y: number[], labels: string[], folds = 5, o: TrainOptions = {}): HeldOut[] {
  const order = shuffled(xs.length);
  const out: HeldOut[] = new Array<HeldOut>(xs.length);
  const k = Math.max(2, Math.min(folds, xs.length));
  for (let f = 0; f < k; f++) {
    const test = order.filter((_, i) => i % k === f);
    const train = order.filter((_, i) => i % k !== f);
    const model = trainSoftmax(train.map((i) => xs[i]), train.map((i) => y[i]), labels, o);
    for (const i of test) {
      const p = predict(model, xs[i]);
      out[i] = { correct: p.label === labels[y[i]], confidence: p.confidence };
    }
  }
  return out;
}

export interface Threshold {
  threshold: number;
  /** Acerto entre as respostas que passam do limite. */
  accuracy: number;
  /** Fração das decisões que o modelo responde sozinho. */
  coverage: number;
}

/**
 * A menor confiança mínima com que o modelo acerta pelo menos `target` das vezes em que responde.
 * null se nenhuma serve (aí ele ainda não está pronto).
 */
export function pickThreshold(held: HeldOut[], target: number, minCoverage: number): Threshold | null {
  for (let th = 0.5; th <= 0.951; th += 0.05) {
    const answered = held.filter((h) => h.confidence >= th);
    if (!answered.length) break;
    const accuracy = answered.filter((h) => h.correct).length / answered.length;
    const coverage = answered.length / held.length;
    if (coverage < minCoverage) break;
    if (accuracy >= target) return { threshold: Math.round(th * 100) / 100, accuracy, coverage };
  }
  return null;
}
