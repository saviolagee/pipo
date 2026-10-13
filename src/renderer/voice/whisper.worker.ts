// Voz 100% local com Whisper (transformers.js + onnxruntime-web em WASM), idioma pt.
// O modelo é baixado do Hugging Face no primeiro uso e fica no cache do app.
// Dois usos: transcrever o que foi dito (captura por voz) e dar nota ao chamado "Pipo" (ver wake.ts).
import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import mjsUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { WakeScores } from '@shared/wake';

const MODEL = 'onnx-community/whisper-base';

const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
  // Sem SharedArrayBuffer (a página não é cross-origin isolated): 1 thread.
  onnx.wasm.numThreads = 1;
}
env.allowLocalModels = false;
env.useBrowserCache = true;

export type WorkerIn =
  | { type: 'load' }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  /** Chamado por voz: `names` traz, por Pipo, os jeitos de dizer o nome dele; `floor`, a nota de "Pipo" abaixo da qual nada mais é calculado. */
  | { type: 'wake'; id: number; audio: Float32Array; names: Array<{ id: number; phrases: string[] }>; floor: number };
export type WorkerOut =
  | { type: 'progress'; percent: number; file: string }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'wake'; id: number; scores: WakeScores; ms: number }
  | { type: 'error'; id?: number; message: string };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!asr) {
    asr = pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') post({ type: 'progress', percent: Math.round(p.progress), file: p.file ?? '' });
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    asr.then(() => post({ type: 'ready' })).catch((e: unknown) => {
      asr = null;
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    });
  }
  return asr;
}

function post(m: WorkerOut): void {
  (self as unknown as Worker).postMessage(m);
}

// ---------- Chamado por voz: notas por decodificação forçada ----------

/** O que o chamado usa do pipeline por dentro (a API pública só transcreve texto livre). */
interface Internals {
  processor: (audio: Float32Array) => Promise<{ input_features: { ort_tensor: unknown } }>;
  tokenizer: { encode: (text: string, o: { add_special_tokens: boolean }) => number[]; convert_tokens_to_ids: (tokens: string[]) => number[] };
  model: {
    sessions: { model: { run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>> } };
    forward: (inputs: Record<string, unknown>) => Promise<Record<string, Tensor>>;
  };
}

/** Jeitos como o modelo escreve "Pipo" (com e sem espaço, caixa e grafias vizinhas). */
const WAKE_FORMS = [' Pipo', 'Pipo', ' pipo', ' PIPO', ' Pippo', ' Pipu'];
/** Se a fala acabou logo depois de "Pipo" com esta certeza, nem vale testar nomes. */
const END_SURE = -1.3;

interface Vocab {
  prefix: number[];
  wake: number[][];
  ends: number[];
  comma: number;
  phrases: Map<string, number[]>;
}
let vocab: Vocab | null = null;

function vocabOf(w: Internals): Vocab {
  if (vocab) return vocab;
  const ids = (text: string): number[] => w.tokenizer.encode(text, { add_special_tokens: false });
  const special = (tokens: string[]): number[] => w.tokenizer.convert_tokens_to_ids(tokens);
  vocab = {
    prefix: special(['<|startoftranscript|>', '<|pt|>', '<|transcribe|>', '<|notimestamps|>']),
    wake: WAKE_FORMS.map(ids),
    ends: [...special(['<|endoftext|>']), ...['.', '!', '?'].map((p) => ids(p)[0])],
    comma: ids(',')[0],
    phrases: new Map(),
  };
  return vocab;
}

type Cache = Record<string, Tensor>;
/** Ponto da decodificação: a distribuição do próximo token (logits + normalizador) e o cache até ali. */
interface Ctx {
  row: Float32Array;
  lse: number;
  cache: Cache;
}
const lp = (c: Ctx, token: number): number => c.row[token] - c.lse;

/**
 * Um passo do decodificador. O primeiro (sem cache) recebe o prefixo inteiro e faz a parte cara, que
 * depende do áudio; os seguintes reaproveitam isso e recebem UM token por vez (com cache, o modelo
 * exportado não mascara tokens futuros dentro do mesmo passo).
 */
async function step(w: Internals, enc: Tensor, tokens: number[], past: Cache | null): Promise<Ctx> {
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from(tokens, (x) => BigInt(x)), [1, tokens.length]);
  const out = await w.model.forward({ encoder_outputs: enc, decoder_input_ids, ...(past ? { past_key_values: past } : {}) });
  const cache: Cache = {};
  for (const name of Object.keys(out)) {
    if (!name.startsWith('present')) continue;
    const key = name.replace('present', 'past_key_values');
    // Com cache, a saída do lado do áudio vem vazia: continua valendo a do primeiro passo.
    cache[key] = past && name.includes('encoder') ? past[key] : out[name];
  }
  const size = out.logits.dims[2];
  const row = (out.logits.data as Float32Array).subarray((tokens.length - 1) * size, tokens.length * size);
  let max = -Infinity;
  for (let i = 0; i < size; i++) if (row[i] > max) max = row[i];
  let sum = 0;
  for (let i = 0; i < size; i++) sum += Math.exp(row[i] - max);
  return { row, lse: max + Math.log(sum), cache };
}

/** Soma das log-probabilidades de `tokens` a partir de um ponto. `needNext`: devolver o ponto depois deles. */
async function follow(w: Internals, enc: Tensor, from: Ctx, tokens: number[], needNext: boolean): Promise<{ sum: number; ctx: Ctx }> {
  let ctx = from;
  let sum = 0;
  for (let i = 0; i < tokens.length; i++) {
    sum += lp(ctx, tokens[i]);
    if (i === tokens.length - 1 && !needNext) break;
    ctx = await step(w, enc, [tokens[i]], ctx.cache);
  }
  return { sum, ctx };
}

async function scoreWake(w: Internals, audio: Float32Array, names: Array<{ id: number; phrases: string[] }>, floor: number): Promise<WakeScores> {
  const v = vocabOf(w);
  const { input_features } = await w.processor(audio);
  const encoded = await w.model.sessions.model.run({ input_features: input_features.ort_tensor });
  const enc = new (Tensor as unknown as new (ort: unknown) => Tensor)(encoded.last_hidden_state);
  const start = await step(w, enc, v.prefix, null);

  // "Pipo": a nota de uma forma nunca passa da nota do primeiro token dela, então dá para podar cedo.
  const forms = v.wake.map((tokens) => ({ tokens, first: lp(start, tokens[0]) })).sort((a, b) => b.first - a.first);
  let best: { sum: number; ctx: Ctx } | null = null;
  for (const f of forms.slice(0, 3)) {
    if (f.first < floor || (best && f.first < best.sum)) continue;
    const r = await follow(w, enc, start, f.tokens, true);
    if (!best || r.sum > best.sum) best = r;
  }
  if (!best) return { wake: forms[0].first, end: 0, names: [] };
  const after = best.ctx;
  const end = Math.max(...v.ends.map((t) => lp(after, t)));
  if (best.sum < floor || end >= END_SURE || !names.length) return { wake: best.sum, end, names: [] };

  // O nome pode vir direto ("Pipo editor") ou depois de vírgula ("Pipo, editor").
  const contexts: Array<{ ctx: Ctx; extra: number; extraTokens: number }> = [{ ctx: after, extra: 0, extraTokens: 0 }];
  const comma = lp(after, v.comma);
  if (comma > -5) contexts.push({ ctx: await step(w, enc, [v.comma], after.cache), extra: comma, extraTokens: 1 });
  const cands = contexts.flatMap((c) =>
    names.flatMap((p) =>
      p.phrases.map((text) => {
        let tokens = v.phrases.get(text);
        if (!tokens) v.phrases.set(text, (tokens = w.tokenizer.encode(text, { add_special_tokens: false })));
        return { c, id: p.id, tokens, first: lp(c.ctx, tokens[0]) + c.extra };
      }),
    ),
  );
  cands.sort((a, b) => b.first - a.first);
  // Só os candidatos cujo começo é plausível são conferidos até o fim.
  const scores = new Map<number, number>();
  for (const k of cands.slice(0, 6)) {
    if (k.first < cands[0].first - 5) break;
    const sum = (await follow(w, enc, k.c.ctx, k.tokens, false)).sum + k.c.extra;
    const score = sum / (k.tokens.length + k.c.extraTokens);
    if (score > (scores.get(k.id) ?? -Infinity)) scores.set(k.id, score);
  }
  return { wake: best.sum, end, names: [...scores].map(([id, score]) => ({ id, score })) };
}

// ---------- Mensagens ----------

// O modelo não aceita duas execuções ao mesmo tempo: os pedidos entram em fila.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    void load();
    return;
  }
  queue = queue.then(async () => {
    try {
      const p = await load();
      if (msg.type === 'wake') {
        const started = performance.now();
        const scores = await scoreWake(p as unknown as Internals, msg.audio, msg.names, msg.floor);
        post({ type: 'wake', id: msg.id, scores, ms: Math.round(performance.now() - started) });
        return;
      }
      const out = await p(msg.audio, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30 });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      post({ type: 'result', id: msg.id, text: text.trim() });
    } catch (e) {
      post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
    }
  });
};
