// Transcrição de voz 100% local com Whisper (transformers.js + onnxruntime-web em WASM), idioma pt.
// O modelo é baixado do Hugging Face no primeiro uso e fica no cache do app.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import mjsUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmUrl from '@ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url';

const MODEL = 'onnx-community/whisper-base';

const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
  // Sem SharedArrayBuffer (a página não é cross-origin isolated): 1 thread.
  onnx.wasm.numThreads = 1;
}
env.allowLocalModels = false;
env.useBrowserCache = true;

export type WorkerIn = { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array };
export type WorkerOut =
  | { type: 'progress'; percent: number; file: string }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
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

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    void load();
    return;
  }
  try {
    const p = await load();
    const out = await p(msg.audio, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30 });
    const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
    post({ type: 'result', id: msg.id, text: text.trim() });
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
