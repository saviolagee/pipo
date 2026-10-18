// "Assistir" vídeos anexados, a pedido do processo principal: aqui na janela do notch o Chromium
// decodifica o vídeo, tira quadros num canvas e transcreve o começo da fala com o Whisper local.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { MediaStatus } from '@shared/ipc-contract';
import { api } from '../lib/api';
import { transcribe } from '../voice/recorder';

/** Largura máxima de cada quadro (o bastante para ler texto na tela, sem pesar). */
const MAX_W = 960;

/** Andamento por anexo, para o chip do arquivo no chat. */
export const useMediaStatus = create<Record<number, MediaStatus>>(() => ({}));

function once(el: HTMLMediaElement, ev: 'loadedmetadata' | 'seeked', ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      el.removeEventListener(ev, ok);
      el.removeEventListener('error', bad);
    };
    const ok = (): void => {
      cleanup();
      resolve();
    };
    const bad = (): void => {
      cleanup();
      reject(new Error('o Pipo não conseguiu abrir este formato de vídeo'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('o vídeo não respondeu'));
    }, ms);
    el.addEventListener(ev, ok);
    el.addEventListener('error', bad);
  });
}

async function grabFrames(url: string, n: number, progress: (p: number) => void): Promise<{ duration: number; width: number; height: number; frames: Array<{ t: number; data: ArrayBuffer }> }> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  // Pedido com CORS: sem isso o canvas fica "contaminado" e não exporta os quadros.
  v.crossOrigin = 'anonymous';
  v.src = url;
  try {
    await once(v, 'loadedmetadata', 30_000);
    let duration = v.duration;
    // Alguns webm só dizem a duração depois de ir até o fim.
    if (!Number.isFinite(duration)) {
      v.currentTime = 1e9;
      await once(v, 'seeked', 30_000);
      duration = v.duration;
    }
    if (!v.videoWidth || !Number.isFinite(duration)) throw new Error('o arquivo não tem imagem de vídeo');
    const scale = Math.min(1, MAX_W / v.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const frames: Array<{ t: number; data: ArrayBuffer }> = [];
    for (let i = 0; i < n; i++) {
      // Um quadro no meio de cada pedaço do vídeo (pega o começo, o meio e o fim).
      const t = Math.max(0, Math.min(duration - 0.05, (duration * (i + 0.5)) / n));
      v.currentTime = t;
      await once(v, 'seeked', 20_000);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
      if (blob) frames.push({ t, data: await blob.arrayBuffer() });
      progress(Math.round(((i + 1) / n) * 100));
    }
    return { duration, width: v.videoWidth, height: v.videoHeight, frames };
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

/** Fala do começo do vídeo (até `maxSec`), em 16 kHz mono para o Whisper. */
async function listen(url: string, maxSec: number): Promise<{ transcript: string | null; noAudio: string | null }> {
  const buf = await (await fetch(url)).arrayBuffer();
  const ac = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(buf);
  } catch {
    return { transcript: null, noAudio: 'o vídeo não tem áudio (ou o áudio está num formato que não abre aqui)' };
  } finally {
    void ac.close();
  }
  const sec = Math.min(decoded.duration, maxSec);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(sec * 16_000)), 16_000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0, 0, sec);
  const pcm = (await off.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  // Só silêncio (ou música baixinha): nem chama o modelo.
  if (peak < 0.01) return { transcript: '', noAudio: null };
  return { transcript: await transcribe(new Float32Array(pcm)), noAudio: null };
}

type Request = { id: string; url: string; frames: number; audio: boolean; audioMaxSec: number };

async function watch(r: Request): Promise<void> {
  try {
    const seen = await grabFrames(r.url, r.frames, (percent) => api.send('media:progress', { id: r.id, stage: 'quadros', percent }));
    let speech: { transcript: string | null; noAudio: string | null } = { transcript: null, noAudio: 'o arquivo é grande demais para transcrever a fala aqui (os quadros foram vistos)' };
    if (r.audio) {
      api.send('media:progress', { id: r.id, stage: 'fala', percent: 0 });
      speech = await listen(r.url, r.audioMaxSec).catch((e: unknown) => ({ transcript: null, noAudio: `não consegui transcrever a fala (${e instanceof Error ? e.message : String(e)})` }));
    }
    api.send('media:result', { id: r.id, ...seen, ...speech });
  } catch (e) {
    api.send('media:result', { id: r.id, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Atende os pedidos do processo principal, um vídeo por vez (montado uma vez, na janela do notch). */
export function useMediaBridge(): void {
  useEffect(() => {
    let queue = Promise.resolve();
    const offReq = api.on('media:request', (r) => {
      queue = queue.then(() => watch(r));
    });
    const offStatus = api.on('media:status', (s) => useMediaStatus.setState({ [s.attachmentId]: s }));
    return () => {
      offReq();
      offStatus();
    };
  }, []);
}
