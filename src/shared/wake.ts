// Chamar o Pipo por voz: "Pipo" abre o chat do branco; "Pipo <nome>" abre o chat daquele Pipo.
// Aqui ficam as partes puras: recortar falas curtas do microfone (sem modelo nenhum) e decidir, pelas
// notas que o modelo de voz dá, se a fala foi um chamado e para quem.
//
// "Pipo" não é palavra de dicionário: a transcrição livre escreve "people", "pessoa", "pipe"… Por isso
// o chamado não é reconhecido pelo texto. O modelo é perguntado direto: "qual a probabilidade de esta
// fala começar com Pipo?" e "qual a de continuar com o nome deste Pipo?" (decodificação forçada).

// ---------- Decisão ----------

/** Notas (log-probabilidades) que o modelo deu a uma fala. Quanto mais perto de zero, mais provável. */
export interface WakeScores {
  /** A fala começar com "Pipo" (soma dos tokens da palavra). */
  wake: number;
  /** A fala acabar logo depois de "Pipo". */
  end: number;
  /** Para cada Pipo testado, a fala continuar com o nome dele (média por token). */
  names: Array<{ id: number; score: number }>;
}

export type WakeMatch = { kind: 'white' } | { kind: 'pipo'; id: number };

export type WakeSensitivity = 'low' | 'normal' | 'high';

/**
 * Nota mínima de "Pipo" por sensibilidade. Calibrado com fala sintética (voz pt-BR do Windows, várias
 * velocidades): com "Pipo" a nota ficou entre -3 e -6; "people", "pico", "pito", "tipo" e "pessoa"
 * ficaram de -6 para baixo; "pipa" passa (só a última vogal muda). Vozes e microfones reais variam,
 * por isso a sensibilidade é ajustável em Configurações. `localStorage['pipo:wakeDebug']='1'` mostra
 * as notas no console.
 */
export const WAKE_MIN: Record<WakeSensitivity, number> = { low: -5, normal: -6, high: -7 };
/** Com um nome reconhecido logo depois, um "Pipo" menos nítido ainda vale: as duas pistas se somam. */
const WITH_NAME_SLACK = 2;
/** Nome dito: os certos ficaram acima de -2; os errados, abaixo de -3,3. */
export const NAME_MIN = -2.5;

/** Abaixo desta nota de "Pipo" nenhuma regra aceita a fala: o modelo nem precisa calcular o resto. */
export const wakeFloor = (level: WakeSensitivity): number => WAKE_MIN[level] - WITH_NAME_SLACK;

/** A fala foi um chamado? Para o branco, ou para o Pipo cujo nome veio depois. */
export function decideWake(s: WakeScores, level: WakeSensitivity = 'normal'): WakeMatch | null {
  const top = s.names.reduce<{ id: number; score: number } | null>((best, n) => (!best || n.score > best.score ? n : best), null);
  const named = top && top.score >= NAME_MIN && top.score > s.end ? top : null;
  if (s.wake >= WAKE_MIN[level]) return named ? { kind: 'pipo', id: named.id } : { kind: 'white' };
  if (named && s.wake >= wakeFloor(level)) return { kind: 'pipo', id: named.id };
  return null;
}

const STOP_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'e']);

/**
 * Jeitos de dizer o nome de um Pipo depois de "Pipo": o nome inteiro e cada palavra forte sozinha
 * ("Pipo editor" chama o "Editor de Vídeo"), como está escrito e em minúsculas. O espaço na frente
 * faz parte do token, do jeito que o modelo escreve.
 */
export function wakePhrases(name: string): string[] {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ').filter((w) => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()));
  return [...new Set([clean, ...words].flatMap((b) => [` ${b}`, ` ${b.toLowerCase()}`]))];
}

// ---------- Áudio: recortar falas curtas ----------

export interface SegmenterOptions {
  sampleRate: number;
  /** Fala mais curta que isso é ruído (clique, tosse). */
  minSpeechMs?: number;
  /** Fala mais longa que isso é conversa, não um chamado: é descartada inteira. */
  maxSpeechMs?: number;
  /** Silêncio que encerra a fala. */
  endSilenceMs?: number;
  /** Trecho guardado antes do início detectado (a primeira sílaba costuma vir fraca). */
  preRollMs?: number;
}

const rms = (frame: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
};

/**
 * Recorta do microfone as falas curtas cercadas de silêncio, pelo volume (sem modelo). Só essas
 * vão para o modelo de voz: conversa longa, música e ruído contínuo nunca saem daqui.
 */
export class SpeechSegmenter {
  private readonly rate: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly endMs: number;
  private readonly preMs: number;
  private state: 'idle' | 'speech' | 'long' = 'idle';
  private floor = 0.004;
  private pre: Float32Array[] = [];
  private buf: Float32Array[] = [];
  private loudRun = 0;
  private silenceMs = 0;
  private speechMs = 0;

  constructor(o: SegmenterOptions) {
    this.rate = o.sampleRate;
    this.minMs = o.minSpeechMs ?? 250;
    this.maxMs = o.maxSpeechMs ?? 3500;
    this.endMs = o.endSilenceMs ?? 550;
    this.preMs = o.preRollMs ?? 300;
  }

  /** Recebe um bloco de áudio; devolve a fala terminada (PCM mono) ou null. */
  feed(frame: Float32Array): Float32Array | null {
    const ms = (frame.length / this.rate) * 1000;
    const level = rms(frame);
    const threshold = Math.max(0.012, this.floor * 3.5);
    const loud = level > (this.state === 'idle' ? threshold : threshold * 0.6);

    if (this.state === 'idle') {
      // O piso de ruído acompanha o ambiente só enquanto ninguém fala.
      if (!loud) this.floor = Math.min(0.05, Math.max(0.001, this.floor * 0.95 + level * 0.05));
      this.pre.push(frame.slice());
      let kept = this.pre.reduce((a, f) => a + f.length, 0);
      while (this.pre.length > 1 && ((kept - this.pre[0].length) / this.rate) * 1000 >= this.preMs) kept -= (this.pre.shift() as Float32Array).length;
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= 2) {
        this.state = 'speech';
        this.buf = this.pre;
        this.pre = [];
        this.silenceMs = 0;
        this.speechMs = ms * 2;
        this.loudRun = 0;
      }
      return null;
    }

    this.silenceMs = loud ? 0 : this.silenceMs + ms;
    if (this.state === 'long') {
      // Som alto que não para (ventilador, música) vira o novo piso, senão ficaria preso aqui.
      this.floor = Math.min(0.05, this.floor * 0.98 + level * 0.02);
      if (this.silenceMs >= this.endMs) this.reset();
      return null;
    }
    this.buf.push(frame.slice());
    if (loud) this.speechMs += ms;
    const totalMs = (this.buf.reduce((a, f) => a + f.length, 0) / this.rate) * 1000;
    if (totalMs - this.silenceMs > this.maxMs) {
      this.state = 'long';
      this.buf = [];
      return null;
    }
    if (this.silenceMs < this.endMs) return null;
    const out = this.speechMs >= this.minMs ? concat(this.buf) : null;
    this.reset();
    return out;
  }

  private reset(): void {
    this.state = 'idle';
    this.buf = [];
    this.pre = [];
    this.loudRun = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((a, f) => a + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}
