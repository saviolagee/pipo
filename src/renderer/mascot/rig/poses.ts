// O "boneco" do mascote: cada expressão é uma pose (forma dos olhos, mãos, bochechas) e um jeito
// de se mexer. O animador (Rig.tsx) leva o boneco de uma pose à outra com molas, então toda troca
// de expressão é suave. Coordenadas no viewBox 0..100 (corpo em x 18..82, y 32..80).
import type { MascotState } from '@shared/types';
import type { MoodBand } from '../mood';

export const EYE_Y = 57;
export const EYE_DX = 11;
/** Centro de giro e de amassar/esticar: a base do corpo. */
export const PIVOT = { x: 50, y: 80 };

/**
 * Forma de um olho: metade da largura e quanto ele abre para cima e para baixo. `down` negativo
 * faz a borda de baixo subir junto (vira um arco sorrindo: ^). `dy` desce ou sobe o olho inteiro.
 */
export interface EyeShape {
  w: number;
  up: number;
  down: number;
  dy: number;
}

export interface HandPose {
  x: number;
  y: number;
  /** 0 = escondida atrás do corpo, 1 = à vista. */
  show: number;
}

export interface Pose {
  eye: EyeShape;
  /** Para onde olha quando o mouse não manda (−1..1). */
  gaze: { x: number; y: number };
  left: HandPose;
  right: HandPose;
  cheeks: number;
  /** Sobrancelhas caídas (triste). */
  brows: number;
  spiral: boolean;
  keyboard: boolean;
  finger: boolean;
}

const OPEN: EyeShape = { w: 2.2, up: 3.8, down: 3.8, dy: 0 };
const WIDE: EyeShape = { w: 3, up: 5, down: 5, dy: -0.5 };
const ARC: EyeShape = { w: 3.5, up: 4.6, down: -2.5, dy: 1.6 };
const LINE: EyeShape = { w: 3.2, up: 0.3, down: 0.3, dy: 0.5 };
const HIDDEN_L: HandPose = { x: 27, y: 62, show: 0 };
const HIDDEN_R: HandPose = { x: 73, y: 62, show: 0 };
const BASE: Pose = { eye: OPEN, gaze: { x: 0, y: 0 }, left: HIDDEN_L, right: HIDDEN_R, cheeks: 0, brows: 0, spiral: false, keyboard: false, finger: false };

export const POSES: Record<MascotState, Pose> = {
  idle: BASE,
  looking: BASE,
  happy: { ...BASE, eye: ARC, cheeks: 0.7, left: { x: 9, y: 47, show: 1 }, right: { x: 91, y: 47, show: 1 } },
  celebrating: { ...BASE, eye: ARC, cheeks: 1, left: { x: 8, y: 39, show: 1 }, right: { x: 92, y: 39, show: 1 } },
  dancing: { ...BASE, eye: ARC, cheeks: 0.5, left: { x: 13, y: 58, show: 1 }, right: { x: 87, y: 58, show: 1 } },
  working: { ...BASE, eye: { w: 2.7, up: 0.3, down: 3.6, dy: 0 }, gaze: { x: 0, y: 0.5 }, left: { x: 38, y: 80, show: 1 }, right: { x: 62, y: 80, show: 1 }, keyboard: true },
  thinking: { ...BASE, eye: { w: 2.2, up: 3.6, down: 3.6, dy: 0 }, gaze: { x: 0.9, y: -1.5 }, right: { x: 67, y: 74, show: 1 } },
  attention: { ...BASE, eye: WIDE, right: { x: 93, y: 41, show: 1 } },
  listening: { ...BASE, eye: { ...WIDE, dy: -0.4 }, gaze: { x: 0.5, y: 0 }, right: { x: 90, y: 52, show: 1 } },
  sleepy: { ...BASE, eye: LINE },
  shh: { ...BASE, eye: LINE, right: { x: 50, y: 75, show: 1 }, finger: true },
  eating: { ...BASE, eye: { w: 3.5, up: -2.3, down: 4.4, dy: -1 } },
  dizzy: { ...BASE, eye: { ...OPEN, up: 0.3, down: 0.3 }, cheeks: 1, spiral: true },
  sad: { ...BASE, eye: { w: 2.3, up: 3.2, down: 3.6, dy: 1.6 }, gaze: { x: 0, y: 0.6 }, brows: 1 },
  tired: { ...BASE, eye: { w: 2.8, up: 0.3, down: 2.6, dy: 1 }, gaze: { x: 0, y: 0.3 } },
};

/** Olhos apertadinhos de quem levou um cutucão. */
export const SQUINT: EyeShape = { w: 3.4, up: 2.6, down: -1.4, dy: 0.8 };

/** Mãos abertas do voo de entrada. */
export const OPEN_HANDS: { left: HandPose; right: HandPose } = { left: { x: 10, y: 56, show: 1 }, right: { x: 90, y: 50, show: 1 } };

export interface BodyMove {
  y: number;
  x: number;
  rot: number;
  sx: number;
  sy: number;
}

const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0): number => Math.sin((t / period) * TAU + phase);

/**
 * Movimento contínuo do corpo em cada expressão. `t` em segundos; `since` é há quanto tempo a
 * expressão começou. Pulos não entram aqui: quem pula é o animador, com gravidade.
 */
export function bodyMove(state: MascotState, band: MoodBand, t: number, since: number): BodyMove {
  switch (state) {
    case 'attention': {
      // Treme por meio segundo, descansa, treme de novo.
      const u = since % 1.85;
      return { y: 0, x: u < 0.45 ? 1.4 * Math.sin((u / 0.45) * TAU * 2.5) : 0, rot: 0, sx: 1, sy: 1 };
    }
    case 'dizzy':
      return { y: 0, x: 1.5 * wave(t, 1.1), rot: 9 * wave(t, 1.1), sx: 1, sy: 1 };
    case 'sad':
      return { y: 3 + 0.4 * wave(t, 4.6), x: 0, rot: 0, sx: 1.03, sy: 0.94 + 0.01 * wave(t, 4.6) };
    case 'tired':
      return { y: 2.5 + 0.5 * wave(t, 3.6), x: 0, rot: 1.2 * wave(t, 7.2), sx: 1.02, sy: 0.95 + 0.01 * wave(t, 3.6) };
    case 'sleepy': {
      // Respira fundo e vai cabeceando: cai devagar e acorda num tranco.
      const u = since % 7;
      const nod = u < 5.4 ? 6 * (u / 5.4) ** 2 : Math.max(0, 6 * (1 - (u - 5.4) / 0.22));
      return { y: 1.5 + 0.5 * wave(t, 3.8), x: 0, rot: nod, sx: 1.01 - 0.01 * wave(t, 3.8), sy: 0.98 + 0.02 * wave(t, 3.8) };
    }
    case 'working':
      return { y: -0.6 - 0.6 * wave(t, 0.55), x: 0, rot: 0, sx: 1, sy: 1 };
    case 'eating': {
      const chew = 0.04 + 0.04 * wave(t, 0.9);
      return { y: 0, x: 0, rot: 0, sx: 1 - chew * 0.5, sy: 1 + chew };
    }
    case 'listening': {
      const s = 1.015 + 0.015 * wave(t, 1.2);
      return { y: 0, x: 1, rot: 4, sx: s, sy: s };
    }
    case 'thinking':
      return { y: -0.75 - 0.75 * wave(t, 2), x: 0, rot: -3 + 1.5 * wave(t, 2), sx: 1, sy: 1 };
    case 'dancing':
      // Balanço lado a lado com quique a cada batida (~120 bpm): amassa ao pousar, estica no ar.
      return { y: -4 * Math.abs(Math.sin(t * TAU)), x: -1.5 * Math.cos(t * TAU), rot: -7 * Math.cos(t * TAU), sx: 1 + 0.035 * Math.cos(t * TAU * 2), sy: 1 - 0.045 * Math.cos(t * TAU * 2) };
    case 'happy':
    case 'celebrating':
      return { y: 0, x: 0, rot: 0, sx: 1, sy: 1 };
    default:
      // idle / looking / shh: flutua, e o humor muda o jeito (seção 6.3).
      if (band === 'high') return { y: -1.5 - 1.5 * wave(t, 2.2), x: 0, rot: 0, sx: 1, sy: 1 + 0.01 * wave(t, 2.2) };
      if (band === 'low') return { y: 0.1 - 0.9 * wave(t, 4.4), x: 0, rot: 0, sx: 1.02, sy: 0.98 };
      // Humor muito baixo: suspiro, sobe e desce devagar.
      if (band === 'veryLow') return { y: 0.4 + 1.6 * wave(t, 5), x: 0, rot: 0, sx: 1.02, sy: 0.985 - 0.03 * wave(t, 5) };
      return { y: -1 - wave(t, 3), x: 0, rot: 0, sx: 1, sy: 1 };
  }
}

/** De quanto em quanto tempo pula sozinho (segundos), ou null. */
export function jumpEvery(state: MascotState): number | null {
  if (state === 'happy') return 0.8;
  if (state === 'celebrating') return 0.95;
  return null;
}

/** Deslocamento das mãos (acenar, digitar, dançar). */
export function handMove(state: MascotState, t: number): { l: [number, number]; r: [number, number] } {
  const tap = (phase: number): number => -3 * Math.max(0, Math.sin((t / 0.36) * TAU + phase));
  switch (state) {
    case 'happy':
      return { l: [0, -2.2 * wave(t, 0.34)], r: [0, 2.2 * wave(t, 0.34)] };
    case 'celebrating':
      return { l: [1.5 * wave(t, 0.45), 5 * wave(t, 0.45)], r: [-1.5 * wave(t, 0.45), -5 * wave(t, 0.45)] };
    case 'attention':
      return { l: [0, 0], r: [3.6 * wave(t, 0.34), -1 * Math.abs(wave(t, 0.34))] };
    case 'thinking':
      return { l: [0, 0], r: [0, -1.3 * Math.max(0, wave(t, 0.7))] };
    case 'listening':
      return { l: [0, 0], r: [0.7 * wave(t, 1.2), 0] };
    case 'working':
      return { l: [0, tap(0)], r: [0, tap(Math.PI)] };
    case 'dancing':
      return { l: [0, -12 * Math.max(0, Math.sin(t * TAU))], r: [0, -12 * Math.max(0, Math.sin(t * TAU + Math.PI))] };
    default:
      return { l: [0, 0], r: [0, 0] };
  }
}

const f = (n: number): string => n.toFixed(2);

/** Desenho de um olho (curva de cima e curva de baixo) a partir da forma. */
export function eyePath(cx: number, cy: number, e: EyeShape): string {
  const k = 4 / 3;
  const y = cy + e.dy;
  const top = y - k * e.up;
  const bottom = y + k * e.down;
  return `M${f(cx - e.w)} ${f(y)}C${f(cx - e.w)} ${f(top)} ${f(cx + e.w)} ${f(top)} ${f(cx + e.w)} ${f(y)}C${f(cx + e.w)} ${f(bottom)} ${f(cx - e.w)} ${f(bottom)} ${f(cx - e.w)} ${f(y)}Z`;
}

/** Quanto o olho está aberto (0..1): decide se o brilho do olho aparece. */
export function eyeOpenness(e: EyeShape): number {
  return Math.max(0, Math.min(1, (e.up + e.down - 4) / 3));
}

/** Espiral de Arquimedes (olhos tontos). */
export const SPIRAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const th = (i / 48) * 2.25 * TAU;
    const r = (i / 48) * 3.6;
    pts.push(`${f(Math.cos(th) * r)} ${f(Math.sin(th) * r)}`);
  }
  return `M${pts.join(' L')}`;
})();
