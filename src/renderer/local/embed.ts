// Ponte entre o app (processo principal) e o modelo de leitura de texto, que roda aqui num worker.
// O principal pede "leia estes textos" e recebe os vetores de volta.
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../lib/api';
import type { EmbedIn, EmbedOut } from './embed.worker';

interface LocalState {
  /** Baixando o modelo de leitura (0–100), ou null. */
  download: number | null;
}

export const useLocalModel = create<LocalState>(() => ({ download: null }));

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<EmbedOut>) => {
      const m = ev.data;
      if (m.type === 'progress') useLocalModel.setState({ download: m.percent >= 100 ? null : m.percent });
      else if (m.type === 'result') {
        useLocalModel.setState({ download: null });
        api.send('embed:result', { id: m.id, vectors: m.vectors });
      } else api.send('embed:result', { id: m.id, error: m.message });
    };
  }
  return worker;
}

/** Atende os pedidos do processo principal (montado uma vez, na janela do notch). */
export function useEmbedBridge(): void {
  useEffect(
    () =>
      api.on('embed:request', ({ id, texts }) => {
        getWorker().postMessage({ type: 'embed', id, texts } satisfies EmbedIn);
      }),
    [],
  );
}
