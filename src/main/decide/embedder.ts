// Pede ao modelo de leitura de texto (que roda na janela do notch) os vetores de uns textos.
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import { emit, getWindow } from '../bus';

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

const waiting = new Map<string, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  ipcMain.on('embed:result', (e, payload: { id: string; vectors?: Float32Array[]; error?: string }) => {
    if (e.sender !== getWindow()?.webContents) return;
    const w = waiting.get(payload.id);
    if (!w) return;
    waiting.delete(payload.id);
    clearTimeout(w.timer);
    if (payload.vectors) w.resolve(payload.vectors.map((v) => new Float32Array(v)));
    else w.reject(new Error(payload.error ?? 'O modelo de leitura não respondeu.'));
  });
}

/**
 * Vetores dos textos, na ordem. O primeiro uso baixa o modelo (~118 MB), então o prazo padrão é
 * longo; nas decisões do dia a dia quem chama passa um prazo curto.
 */
export function embedTexts(texts: string[], timeoutMs = 10 * 60_000): Promise<Float32Array[]> {
  listen();
  if (!texts.length) return Promise.resolve([]);
  if (!getWindow()) return Promise.reject(new Error('A janela do Pipo não está aberta.'));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('O modelo de leitura demorou demais.'));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    emit('embed:request', { id, texts });
  });
}
