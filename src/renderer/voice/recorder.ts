// Grava o microfone e converte para PCM mono 16 kHz (formato que o Whisper espera).
import type { WorkerIn, WorkerOut } from './whisper.worker';

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  level = 0;
  private analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
  }

  /** Nível de áudio 0..1 (para as ondinhas do mascote). */
  readLevel(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak;
  }

  async stop(): Promise<Float32Array> {
    const rec = this.rec;
    if (!rec) return new Float32Array();
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.rec = null;
    const blob = new Blob(this.chunks, { type: rec.mimeType });
    const buf = await blob.arrayBuffer();
    const decodeCtx = new AudioContext();
    const decoded = await decodeCtx.decodeAudioData(buf);
    void decodeCtx.close();
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  cancel(): void {
    this.rec?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.rec = null;
  }
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
export const whisperListeners: Array<(m: WorkerOut) => void> = [];

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      whisperListeners.forEach((l) => l(m));
      if (m.type === 'result') {
        waiting.get(m.id)?.resolve(m.text);
        waiting.delete(m.id);
      } else if (m.type === 'error' && m.id) {
        waiting.get(m.id)?.reject(new Error(m.message));
        waiting.delete(m.id);
      }
    };
  }
  return worker;
}

/** Pré-carrega o modelo (baixa no primeiro uso). */
export function preloadWhisper(): void {
  getWorker().postMessage({ type: 'load' } satisfies WorkerIn);
}

export function transcribe(audio: Float32Array): Promise<string> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio } satisfies WorkerIn, [audio.buffer]);
  });
}
