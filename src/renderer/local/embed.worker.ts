// Modelo de leitura de texto do Pipo, 100% local (transformers.js + onnxruntime-web em WASM).
// Transforma um texto num vetor de números; o classificador de cada atividade decide em cima dele.
// O modelo (~118 MB) é baixado do Hugging Face no primeiro uso e fica no cache do app.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import mjsUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url';

/** Multilíngue (inclui português), licença MIT, 384 números por texto. */
const MODEL = 'Xenova/multilingual-e5-small';

const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
  // Sem SharedArrayBuffer (a página não é cross-origin isolated): 1 thread.
  onnx.wasm.numThreads = 1;
}
env.allowLocalModels = false;
env.useBrowserCache = true;

export type EmbedIn = { type: 'embed'; id: string; texts: string[] };
export type EmbedOut = { type: 'progress'; percent: number } | { type: 'result'; id: string; vectors: Float32Array[] } | { type: 'error'; id: string; message: string };

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function post(m: EmbedOut): void {
  (self as unknown as Worker).postMessage(m);
}

function load(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = pipeline('feature-extraction', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        // Só o arquivo grande interessa para a barra de progresso.
        if (p.status === 'progress' && typeof p.progress === 'number' && (p.file ?? '').endsWith('.onnx')) post({ type: 'progress', percent: Math.round(p.progress) });
      },
    }) as Promise<FeatureExtractionPipeline>;
    extractor.catch(() => {
      extractor = null;
    });
  }
  return extractor;
}

// Um pedido por vez: o modelo não roda dois textos ao mesmo tempo.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<EmbedIn>) => {
  const msg = ev.data;
  if (msg.type !== 'embed') return;
  queue = queue.then(async () => {
    try {
      const model = await load();
      const vectors: Float32Array[] = [];
      for (const text of msg.texts) {
        // O prefixo "query: " é o que este modelo espera para comparar e classificar textos.
        const out = await model(`query: ${text}`, { pooling: 'mean', normalize: true });
        vectors.push(new Float32Array(out.data as Float32Array));
      }
      post({ type: 'result', id: msg.id, vectors });
    } catch (e) {
      post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
    }
  });
};
