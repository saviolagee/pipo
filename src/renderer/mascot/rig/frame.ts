// O quadro do boneco (tudo que muda de um instante para o outro), as partes do desenho e a função
// que leva um quadro para o SVG. O laço de animação fica no Rig.tsx.
import type { Accessory, MascotState } from '@shared/types';
import { EYE_DX, EYE_Y, eyePath, lidPath, MOUTH_Y, mouthPath, OPEN_HANDS, PIVOT, tonguePath, type EyeShape, type HandPose, type MouthShape, type Pose } from './poses';

/** Acessórios que ficam no rosto (acompanham o olhar); o resto fica no corpo. */
export const ON_FACE: Accessory[] = ['glasses', 'cool_glasses'];
export const HAND_R = 4.4;
export const PUPIL_R = 3.2;
export const CALM: MascotState[] = ['sleepy', 'tired', 'sad', 'shh'];
export const INK = '#0A0A0B';
export const SCLERA = '#FFF1A8';
export const TONGUE = '#F4A3A0';
export const MOUTH_INSIDE = '#6B1D1D';


/** Tudo que muda de um quadro para o outro. */
export interface Frame {
  x: number;
  y: number;
  rot: number;
  /** Pirueta: gira em torno do meio do corpo (o resto gira em torno da base). */
  turn: number;
  sx: number;
  sy: number;
  gx: number;
  gy: number;
  eye: EyeShape;
  mouth: MouthShape;
  l: { x: number; y: number; r: number };
  r: { x: number; y: number; r: number };
  cheeks: number;
  spiral: number;
  spin: number;
  keyboard: number;
  finger: number;
  stars: number;
}

type El = SVGElement | null;
export interface Parts {
  body: El;
  /** Mãos: mesmo movimento do corpo, mas desenhadas por cima do teclado. */
  hands: El;
  face: El;
  eyes: El;
  eyeL: El;
  eyeR: El;
  clipL: El;
  clipR: El;
  lidL: El;
  lidR: El;
  pupilL: El;
  pupilR: El;
  mouth: El;
  inside: El;
  tongue: El;
  tongueBody: El;
  tongueLine: El;
  spirals: El;
  spiralL: El;
  spiralR: El;
  handL: El;
  handR: El;
  cheeks: El;
  keyboard: El;
  finger: El;
  stars: El;
}
export const NO_PARTS: Parts = { body: null, hands: null, face: null, eyes: null, eyeL: null, eyeR: null, clipL: null, clipR: null, lidL: null, lidR: null, pupilL: null, pupilR: null, mouth: null, inside: null, tongue: null, tongueBody: null, tongueLine: null, spirals: null, spiralL: null, spiralR: null, handL: null, handR: null, cheeks: null, keyboard: null, finger: null, stars: null };

export const n = (v: number): string => v.toFixed(2);
export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A pose parada de uma expressão (ícones pequenos e o primeiro quadro do boneco vivo). */
export function restFrame(pose: Pose, open: boolean): Frame {
  const hands = open ? OPEN_HANDS : pose;
  const hand = (h: HandPose): Frame['l'] => ({ x: h.x, y: h.y, r: open || pose.finger ? HAND_R * h.show : 0 });
  return { x: 0, y: 0, rot: 0, turn: 0, sx: 1, sy: 1, gx: pose.gaze.x, gy: pose.gaze.y, eye: pose.eye, mouth: pose.mouth, l: hand(hands.left), r: hand(hands.right), cheeks: pose.cheeks, spiral: pose.spiral ? 1 : 0, spin: 0, keyboard: 0, finger: pose.finger ? 1 : 0, stars: 0 };
}

export function draw(p: Parts, f: Frame, t: number): void {
  if (!p.body) return;
  const whole = `translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rot)} ${PIVOT.x} ${PIVOT.y}) rotate(${n(f.turn)} 50 57) translate(${PIVOT.x} ${PIVOT.y}) scale(${n(f.sx)} ${n(f.sy)}) translate(${-PIVOT.x} ${-PIVOT.y})`;
  p.body.setAttribute('transform', whole);
  p.hands?.setAttribute('transform', whole);
  // O rosto desliza na direção do olhar e as pupilas vão além: dá volume à bola.
  p.face?.setAttribute('transform', `translate(${n(f.gx * 1.7)} ${n(f.gy * 1.1)})`);
  for (const [side, eye, clip, lid, pupil] of [
    [-1, p.eyeL, p.clipL, p.lidL, p.pupilL],
    [1, p.eyeR, p.clipR, p.lidR, p.pupilR],
  ] as const) {
    const cx = 50 + side * EYE_DX;
    const d = eyePath(cx, EYE_Y, f.eye, side);
    eye?.setAttribute('d', d);
    clip?.setAttribute('d', d);
    lid?.setAttribute('d', lidPath(cx, EYE_Y, f.eye, side));
    pupil?.setAttribute('cx', n(cx + f.gx * 4.1));
    pupil?.setAttribute('cy', n(EYE_Y + f.eye.dy + (f.eye.down - f.eye.up) * 0.42 + f.gy * 1.7));
  }
  p.eyes?.setAttribute('opacity', n(1 - f.spiral));
  p.spirals?.setAttribute('opacity', n(f.spiral));
  p.spiralL?.setAttribute('transform', `translate(${50 - EYE_DX} ${EYE_Y}) rotate(${n(-f.spin)})`);
  p.spiralR?.setAttribute('transform', `translate(${50 + EYE_DX} ${EYE_Y}) rotate(${n(f.spin)})`);

  const m = f.mouth;
  const open = m.open > 0.04;
  p.mouth?.setAttribute('d', mouthPath(50, MOUTH_Y, m));
  p.mouth?.setAttribute('fill', open ? MOUTH_INSIDE : 'none');
  if (p.inside) {
    // Aberta, a língua aparece lá dentro, encostada na borda de baixo.
    const ry = clamp(m.open) * 2.5;
    p.inside.setAttribute('cy', n(MOUTH_Y + m.curve + 7 * m.open - ry - 0.5));
    p.inside.setAttribute('rx', n(m.w * 0.46));
    p.inside.setAttribute('ry', n(ry));
    p.inside.setAttribute('opacity', open ? '1' : '0');
  }
  const out = open ? 0 : clamp(m.tongue, 0, 1.2);
  const tongue = tonguePath(out);
  // A língua sai perto do canto direito da boca, um pouco abaixo do risco quando ele curva.
  p.tongue?.setAttribute('transform', `translate(${n(50 + m.w * 0.6)} ${n(MOUTH_Y + m.curve * 0.62)})`);
  p.tongue?.setAttribute('opacity', out > 0.08 ? '1' : '0');
  p.tongueBody?.setAttribute('d', tongue.body);
  p.tongueLine?.setAttribute('d', tongue.line);

  for (const [el, h] of [
    [p.handL, f.l],
    [p.handR, f.r],
  ] as const) {
    el?.setAttribute('cx', n(h.x));
    el?.setAttribute('cy', n(h.y));
    el?.setAttribute('r', n(Math.max(0, h.r)));
    el?.setAttribute('opacity', h.r > 0.3 ? '1' : '0');
  }
  p.cheeks?.setAttribute('opacity', n(0.6 * clamp(f.cheeks)));
  p.keyboard?.setAttribute('opacity', n(clamp(f.keyboard)));
  p.finger?.setAttribute('opacity', n(clamp(f.finger)));
  if (p.stars) {
    p.stars.setAttribute('opacity', n(clamp(f.stars)));
    // Três estrelinhas rodando em volta da cabeça de quem está tonto.
    Array.from(p.stars.children).forEach((star, i) => {
      const a = t * 2.6 + (i * Math.PI * 2) / 3;
      star.setAttribute('transform', `translate(${n(50 + 26 * Math.cos(a))} ${n(27 + 5 * Math.sin(a))}) scale(${n(0.7 + 0.3 * Math.sin(a))})`);
    });
  }
}
