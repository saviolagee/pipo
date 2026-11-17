// O "boneco" do mascote: uma bola de contorno grosso, olhos de pálpebra pesada que olham de lado,
// boca reta e a língua de fora. Cada expressão é uma pose (olhos, boca, mãos, bochechas) e um jeito
// de se mexer; o animador (Rig.tsx) leva de uma pose à outra com molas. Coordenadas no viewBox
// 0..100 (corpo em x 22..78, y 30..84).
import type { MascotState } from '@shared/types';
import type { MoodBand } from '../mood';

/** A bola, um pouco irregular (desenhada à mão). */
export const BODY = 'M50 30.2 C66 29.6 78.4 41 78.2 57.5 C78 73 66 83.8 49.5 83.8 C33.6 83.8 21.8 72.6 21.8 56.6 C21.8 41.2 34 30.8 50 30.2 Z';
export const EYE_Y = 52.5;
export const EYE_DX = 10.7;
export const MOUTH_Y = 70;
/** Centro de giro e de amassar/esticar: a base do corpo. */
export const PIVOT = { x: 50, y: 84 };

/**
 * Forma de um olho: metade da largura, quanto a pálpebra de cima sobe e a borda de baixo desce no
 * meio (`down` negativo faz a borda de baixo subir: vira um arco sorrindo). `tilt` inclina a
 * pálpebra (positivo: canto de fora mais alto, o olhar "de canto"; negativo: triste) e `skew` é a
 * diferença entre os dois olhos (um mais inclinado que o outro).
 */
export interface EyeShape {
  w: number;
  up: number;
  down: number;
  dy: number;
  tilt: number;
  skew: number;
}

/** Boca: metade da largura, curva (positivo sorri), abertura (0..1) e quanto da língua aparece. */
export interface MouthShape {
  w: number;
  curve: number;
  open: number;
  tongue: number;
}

export interface HandPose {
  x: number;
  y: number;
  /** 0 = escondida atrás do corpo, 1 = à vista. */
  show: number;
}

export interface Pose {
  eye: EyeShape;
  mouth: MouthShape;
  /** Para onde olha quando o mouse não manda (−1..1). */
  gaze: { x: number; y: number };
  left: HandPose;
  right: HandPose;
  cheeks: number;
  spiral: boolean;
  keyboard: boolean;
  finger: boolean;
}

/** O olhar de sempre: pálpebra pesada, de canto. */
const SMUG: EyeShape = { w: 8.6, up: 0.4, down: 7.6, dy: -0.6, tilt: 0.9, skew: 0.5 };
const WIDE: EyeShape = { w: 7.4, up: 5.4, down: 5.4, dy: 0, tilt: 0, skew: 0 };
const ARC: EyeShape = { w: 7.6, up: 4.6, down: -1.9, dy: 1, tilt: 0, skew: 0 };
const SHUT: EyeShape = { w: 7.6, up: 0.15, down: 0.4, dy: 1.4, tilt: 1.4, skew: 0 };
const FLAT: MouthShape = { w: 10.5, curve: 0, open: 0, tongue: 1 };
const GRIN: MouthShape = { w: 9.5, curve: 2.2, open: 0.62, tongue: 0 };
const HIDDEN_L: HandPose = { x: 31, y: 64, show: 0 };
const HIDDEN_R: HandPose = { x: 69, y: 64, show: 0 };
const BASE: Pose = { eye: SMUG, mouth: FLAT, gaze: { x: 0.55, y: 0.1 }, left: HIDDEN_L, right: HIDDEN_R, cheeks: 0, spiral: false, keyboard: false, finger: false };

export const POSES: Record<MascotState, Pose> = {
  idle: BASE,
  looking: { ...BASE, eye: { ...SMUG, up: 2.4, down: 5.2, tilt: 1.2, skew: 0.5 } },
  happy: { ...BASE, eye: ARC, mouth: GRIN, gaze: { x: 0, y: 0 }, cheeks: 0.7, left: { x: 11, y: 49, show: 1 }, right: { x: 89, y: 49, show: 1 } },
  celebrating: { ...BASE, eye: ARC, mouth: { ...GRIN, open: 0.85, w: 10.5 }, gaze: { x: 0, y: 0 }, cheeks: 1, left: { x: 10, y: 40, show: 1 }, right: { x: 90, y: 40, show: 1 } },
  dancing: { ...BASE, eye: ARC, mouth: { w: 9.5, curve: 2.6, open: 0, tongue: 1 }, gaze: { x: 0, y: 0 }, cheeks: 0.5, left: { x: 14, y: 60, show: 1 }, right: { x: 86, y: 60, show: 1 } },
  // Concentrado: olha para baixo, com a pontinha da língua de fora.
  working: { ...BASE, eye: { w: 7.8, up: 0.3, down: 3.9, dy: 0.6, tilt: 1.5, skew: 0 }, mouth: { w: 6.5, curve: 0, open: 0, tongue: 0.75 }, gaze: { x: 0, y: 0.9 }, left: { x: 38, y: 85, show: 1 }, right: { x: 62, y: 85, show: 1 }, keyboard: true },
  thinking: { ...BASE, eye: { w: 7.6, up: 3.2, down: 3.6, dy: 0, tilt: 0.8, skew: 0.6 }, mouth: { w: 5, curve: -0.6, open: 0, tongue: 0 }, gaze: { x: 0.9, y: -1.3 }, right: { x: 68, y: 78, show: 1 } },
  attention: { ...BASE, eye: WIDE, mouth: { w: 3.6, curve: 0, open: 0.5, tongue: 0 }, gaze: { x: 0, y: 0 }, right: { x: 91, y: 42, show: 1 } },
  listening: { ...BASE, eye: { ...WIDE, up: 4.4, down: 4.8 }, mouth: { w: 5.5, curve: 0.8, open: 0, tongue: 0 }, gaze: { x: 0.5, y: 0 }, right: { x: 88, y: 53, show: 1 } },
  sleepy: { ...BASE, eye: SHUT, mouth: { w: 7.5, curve: 0, open: 0, tongue: 0.85 }, gaze: { x: 0, y: 0.3 } },
  shh: { ...BASE, eye: { ...SMUG, up: 1.6, tilt: 1, skew: 0 }, mouth: { w: 4, curve: 0, open: 0, tongue: 0 }, gaze: { x: 0, y: 0 }, right: { x: 50, y: 77, show: 1 }, finger: true },
  eating: { ...BASE, eye: { ...ARC, up: 3.6 }, mouth: { w: 10, curve: 1, open: 1, tongue: 0 }, gaze: { x: 0, y: -0.4 } },
  dizzy: { ...BASE, eye: { ...SHUT, tilt: 0 }, mouth: { w: 8, curve: -1.2, open: 0, tongue: 1 }, gaze: { x: 0, y: 0 }, cheeks: 1, spiral: true },
  sad: { ...BASE, eye: { w: 7.6, up: 2.4, down: 4, dy: 1.2, tilt: -2.4, skew: 0 }, mouth: { w: 8, curve: -2.6, open: 0, tongue: 0 }, gaze: { x: 0, y: 0.7 } },
  tired: { ...BASE, eye: { w: 7.8, up: 0.3, down: 2.8, dy: 1, tilt: 0.8, skew: 0.4 }, mouth: { w: 8.5, curve: -0.6, open: 0, tongue: 0.6 }, gaze: { x: 0, y: 0.3 } },
};

/** Olhos apertadinhos de quem levou um cutucão. */
export const SQUINT: EyeShape = { w: 7.6, up: 2.6, down: -1.2, dy: 0.8, tilt: 0, skew: 0 };

/** Mãos abertas do voo de entrada. */
export const OPEN_HANDS: { left: HandPose; right: HandPose } = { left: { x: 12, y: 58, show: 1 }, right: { x: 88, y: 52, show: 1 } };

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

/** Cantos e pontos de controle de um olho. `side` −1 = olho esquerdo, 1 = direito. */
function eyePoints(cx: number, cy: number, e: EyeShape, side: -1 | 1): { ox: number; oy: number; ix: number; iy: number; top: number; bottom: number } {
  const y = cy + e.dy;
  const tilt = e.tilt + (side < 0 ? e.skew : -e.skew);
  return { ox: cx + side * e.w, oy: y - tilt, ix: cx - side * e.w, iy: y + tilt, top: y - 2 * e.up, bottom: y + 2 * e.down };
}

/** Contorno do olho: pálpebra de cima e borda de baixo, com os cantos em ponta. */
export function eyePath(cx: number, cy: number, e: EyeShape, side: -1 | 1): string {
  const p = eyePoints(cx, cy, e, side);
  return `M${f(p.ox)} ${f(p.oy)}Q${f(cx)} ${f(p.top)} ${f(p.ix)} ${f(p.iy)}Q${f(cx)} ${f(p.bottom)} ${f(p.ox)} ${f(p.oy)}Z`;
}

/** Só a pálpebra de cima (traço mais grosso por cima do olho). */
export function lidPath(cx: number, cy: number, e: EyeShape, side: -1 | 1): string {
  const p = eyePoints(cx, cy, e, side);
  return `M${f(p.ox)} ${f(p.oy)}Q${f(cx)} ${f(p.top)} ${f(p.ix)} ${f(p.iy)}`;
}

/** Quanto o olho está aberto (0..1): olho quase fechado não pisca. */
export function eyeOpenness(e: EyeShape): number {
  return Math.max(0, Math.min(1, (e.up + e.down - 1) / 4));
}

/** A boca: um risco (reto, sorrindo ou triste) ou, aberta, uma forma fechada. */
export function mouthPath(cx: number, cy: number, m: MouthShape): string {
  const l = f(cx - m.w);
  const r = f(cx + m.w);
  if (m.open <= 0.04) return `M${l} ${f(cy)}Q${f(cx)} ${f(cy + 2 * m.curve)} ${r} ${f(cy)}`;
  // Aberta, a borda de cima fica mais reta e a de baixo desce.
  const top = cy + 2 * m.curve * (1 - 0.65 * Math.min(1, m.open / 0.3));
  return `M${l} ${f(cy)}Q${f(cx)} ${f(top)} ${r} ${f(cy)}Q${f(cx)} ${f(cy + 2 * m.curve + 14 * m.open)} ${l} ${f(cy)}Z`;
}

/** A língua pendurada na boca (coordenadas a partir do ponto em que ela sai). */
export function tonguePath(amount: number): { body: string; line: string } {
  const h = 6.2 * Math.max(0, amount);
  const ry = Math.min(3, h);
  return { body: `M-3 0V${f(h - ry)}A3 ${f(ry)} 0 0 0 3 ${f(h - ry)}V0Z`, line: `M0 ${f(h * 0.2)}V${f(h * 0.6)}` };
}

/** Espiral de Arquimedes (olhos tontos). */
export const SPIRAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const th = (i / 48) * 2.25 * TAU;
    const r = (i / 48) * 4.4;
    pts.push(`${f(Math.cos(th) * r)} ${f(Math.sin(th) * r)}`);
  }
  return `M${pts.join(' L')}`;
})();
