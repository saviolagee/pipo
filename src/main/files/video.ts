// "Assistir" um vídeo anexado: a janela do Pipo tira quadros ao longo dele e transcreve o começo da
// fala (Whisper, no computador). Fica numa pasta ao lado do anexo; o agente lê a descrição e abre os
// quadros como imagens. Nada sai da máquina.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import type { Attachment } from '@shared/types';
import { emit, getWindow } from '../bus';
import { fileUrl } from './protocol';

export interface VideoReading {
  duracaoSeg: number;
  largura: number;
  altura: number;
  quadros: Array<{ seg: number; caminho: string }>;
  /** Fala transcrita (só o começo, ver AUDIO_MAX_SEC), ou null. */
  fala: string | null;
  /** Até que segundo a fala foi transcrita. */
  falaAte: number | null;
  /** Por que não tem fala (sem áudio, arquivo grande demais…). */
  semFala: string | null;
  /** Arquivo com tudo isso escrito, para o agente ler. */
  descricao: string;
}

export interface MediaFrame {
  t: number;
  data: ArrayBuffer;
}

export interface MediaResult {
  id: string;
  duration?: number;
  width?: number;
  height?: number;
  frames?: MediaFrame[];
  transcript?: string | null;
  noAudio?: string | null;
  error?: string;
}

const FRAMES = 8;
/** Para transcrever, o áudio inteiro é decodificado na memória: acima disso, só os quadros. */
const AUDIO_MAX_BYTES = 150 * 1024 * 1024;
export const AUDIO_MAX_SEC = 180;
const TIMEOUT_MS = 12 * 60_000;

export const readingDir = (path: string): string => `${path}.leitura`;

/** 75 → "1:15"; 3725 → "1:02:05". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Texto da descrição que o agente lê. */
export function describeReading(filename: string, r: Omit<VideoReading, 'descricao'>): string {
  const step = r.quadros.length ? r.duracaoSeg / r.quadros.length : 0;
  return [
    `# Vídeo: ${filename}`,
    `Duração: ${clock(r.duracaoSeg)} · ${r.largura}×${r.altura}`,
    '',
    `## Quadros (${r.quadros.length}, um a cada ~${Math.max(1, Math.round(step))} s; abra cada um como imagem)`,
    ...r.quadros.map((q) => `- ${clock(q.seg)} → ${q.caminho}`),
    '',
    r.fala !== null ? `## Fala (transcrita no computador${r.falaAte !== null && r.falaAte < r.duracaoSeg ? `, só os primeiros ${clock(r.falaAte)}` : ''})` : '## Fala',
    r.fala !== null ? r.fala || '(nenhuma fala reconhecida)' : (r.semFala ?? 'não transcrita'),
  ].join('\n');
}

const waiting = new Map<string, { resolve: (r: MediaResult) => void; timer: NodeJS.Timeout; attachment: Attachment }>();
const pending = new Map<number, Promise<VideoReading>>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  ipcMain.on('media:progress', (e, p: { id: string; stage: 'quadros' | 'fala'; percent: number }) => {
    if (e.sender !== getWindow()?.webContents) return;
    const w = waiting.get(p.id);
    if (w) emit('media:status', { attachmentId: w.attachment.id, stage: p.stage, percent: p.percent, done: false });
  });
  ipcMain.on('media:result', (e, r: MediaResult) => {
    if (e.sender !== getWindow()?.webContents) return;
    const w = waiting.get(r.id);
    if (!w) return;
    waiting.delete(r.id);
    clearTimeout(w.timer);
    w.resolve(r);
  });
}

function requestReading(a: Attachment): Promise<MediaResult> {
  listen();
  if (!getWindow()) return Promise.reject(new Error('A janela do Pipo não está aberta.'));
  const id = randomUUID();
  const audio = statSync(a.path).size <= AUDIO_MAX_BYTES;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve({ id, error: 'Demorou demais para assistir.' });
    }, TIMEOUT_MS);
    waiting.set(id, { resolve, timer, attachment: a });
    emit('media:request', { id, url: fileUrl(a.path), frames: FRAMES, audio, audioMaxSec: AUDIO_MAX_SEC });
  });
}

/** Guarda quadros e descrição na pasta de leitura do vídeo. */
export function saveReading(a: Attachment, r: MediaResult): VideoReading {
  const dir = readingDir(a.path);
  mkdirSync(dir, { recursive: true });
  const quadros = (r.frames ?? []).map((f, i) => {
    const caminho = join(dir, `quadro-${String(i + 1).padStart(2, '0')}-${clock(f.t).replace(/:/g, 'm')}s.jpg`);
    writeFileSync(caminho, Buffer.from(f.data));
    return { seg: Math.round(f.t * 10) / 10, caminho };
  });
  const duracaoSeg = Math.round((r.duration ?? 0) * 10) / 10;
  const fala = typeof r.transcript === 'string' ? r.transcript.trim() : null;
  const base = {
    duracaoSeg,
    largura: r.width ?? 0,
    altura: r.height ?? 0,
    quadros,
    fala,
    falaAte: fala !== null ? Math.min(duracaoSeg, AUDIO_MAX_SEC) : null,
    semFala: fala !== null ? null : (r.noAudio ?? null),
  };
  const descricao = join(dir, 'leitura.md');
  writeFileSync(descricao, describeReading(a.filename, base));
  const reading: VideoReading = { ...base, descricao };
  writeFileSync(join(dir, 'leitura.json'), JSON.stringify(reading, null, 2));
  return reading;
}

function savedReading(a: Attachment): VideoReading | null {
  const f = join(readingDir(a.path), 'leitura.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as VideoReading;
  } catch {
    return null;
  }
}

/** Assiste ao vídeo uma vez só (pedidos repetidos esperam o mesmo resultado). */
export function analyzeVideo(a: Attachment): Promise<VideoReading> {
  const saved = savedReading(a);
  if (saved) return Promise.resolve(saved);
  const cur = pending.get(a.id);
  if (cur) return cur;
  const p = requestReading(a)
    .then((r) => {
      if (r.error) throw new Error(r.error);
      const reading = saveReading(a, r);
      emit('media:status', { attachmentId: a.id, stage: 'pronto', percent: 100, done: true });
      return reading;
    })
    .catch((e: unknown) => {
      emit('media:status', { attachmentId: a.id, stage: 'erro', percent: 0, done: true, error: e instanceof Error ? e.message : String(e) });
      throw e;
    })
    .finally(() => pending.delete(a.id));
  pending.set(a.id, p);
  return p;
}

/** A leitura, esperando no máximo `waitMs` (null se não ficou pronta ou se não deu para assistir). */
export async function videoReading(a: Attachment, waitMs: number): Promise<VideoReading | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), waitMs)));
  try {
    return await Promise.race([analyzeVideo(a).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}
