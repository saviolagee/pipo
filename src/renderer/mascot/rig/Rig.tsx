// O boneco do mascote. O desenho (SVG) é um só; quando ele está "vivo", um laço por quadro leva
// cada parte até a pose da expressão com molas e gravidade: olhos que se transformam, mãos que
// entram e saem, pulo que estica no ar e amassa ao pousar, piscadas e olhadelas.
import { motion, useAnimationFrame } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import type { Accessory, MascotState } from '@shared/types';
import { AccessoriesFront, CapeBehind } from '../Accessories';
import type { MoodBand } from '../mood';
import { bodyMove, EYE_DX, EYE_Y, eyeOpenness, eyePath, handMove, jumpEvery, OPEN_HANDS, PIVOT, POSES, SPIRAL, SQUINT, type EyeShape, type HandPose, type Pose } from './poses';

/** Acessórios que ficam no rosto (acompanham o olhar); o resto fica no corpo. */
const ON_FACE: Accessory[] = ['glasses', 'cool_glasses'];
const HAND_R = 4.2;
const CALM: MascotState[] = ['sleepy', 'tired', 'sad', 'shh'];
const INK = '#0A0A0B';

export interface RigProps {
  state: MascotState;
  band: MoodBand;
  mood: number;
  accessories: Accessory[];
  look: { x: number; y: number } | null;
  bump: number;
  hands: 'open' | null;
  still: boolean;
  sipping: boolean;
  bodyFill: string;
  handFill: string;
  /** Brilho nos olhos (só em tamanhos em que dá para ver). */
  shine: boolean;
}

/** Tudo que muda de um quadro para o outro. */
interface Frame {
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
  l: { x: number; y: number; r: number };
  r: { x: number; y: number; r: number };
  cheeks: number;
  brows: number;
  spiral: number;
  spin: number;
  keyboard: number;
  finger: number;
  stars: number;
}

interface Parts {
  body: SVGGElement | null;
  /** Mãos: mesmo movimento do corpo, mas desenhadas por cima do teclado. */
  hands: SVGGElement | null;
  face: SVGGElement | null;
  gloss: SVGRectElement | null;
  eyes: SVGGElement | null;
  eyeL: SVGPathElement | null;
  eyeR: SVGPathElement | null;
  shineL: SVGCircleElement | null;
  shineR: SVGCircleElement | null;
  spirals: SVGGElement | null;
  spiralL: SVGGElement | null;
  spiralR: SVGGElement | null;
  handL: SVGCircleElement | null;
  handR: SVGCircleElement | null;
  cheeks: SVGGElement | null;
  brows: SVGGElement | null;
  keyboard: SVGGElement | null;
  finger: SVGGElement | null;
  stars: SVGGElement | null;
}

const n = (v: number): string => v.toFixed(2);
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A pose parada de uma expressão (ícones pequenos e o primeiro quadro do boneco vivo). */
function restFrame(pose: Pose, open: boolean, withHands: boolean): Frame {
  const hands = open ? OPEN_HANDS : pose;
  const hand = (h: HandPose): Frame['l'] => ({ x: h.x, y: h.y, r: withHands || open || pose.finger ? HAND_R * h.show : 0 });
  return { x: 0, y: 0, rot: 0, turn: 0, sx: 1, sy: 1, gx: pose.gaze.x, gy: pose.gaze.y, eye: pose.eye, l: hand(hands.left), r: hand(hands.right), cheeks: pose.cheeks, brows: pose.brows, spiral: pose.spiral ? 1 : 0, spin: 0, keyboard: 0, finger: pose.finger ? 1 : 0, stars: 0 };
}

function draw(p: Parts, f: Frame, shine: boolean, t: number): void {
  if (!p.body) return;
  const whole = `translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rot)} ${PIVOT.x} ${PIVOT.y}) rotate(${n(f.turn)} 50 56) translate(${PIVOT.x} ${PIVOT.y}) scale(${n(f.sx)} ${n(f.sy)}) translate(${-PIVOT.x} ${-PIVOT.y})`;
  p.body.setAttribute('transform', whole);
  p.hands?.setAttribute('transform', whole);
  // O rosto desliza um pouco na direção do olhar e os olhos vão além: dá volume ao corpo.
  p.face?.setAttribute('transform', `translate(${n(f.gx * 1.2)} ${n(f.gy * 0.8)})`);
  p.gloss?.setAttribute('x', n(27 - f.gx * 1.4));
  const ex = f.gx * 1.8;
  const ey = f.gy * 1.2;
  p.eyeL?.setAttribute('d', eyePath(50 - EYE_DX + ex, EYE_Y + ey, f.eye));
  p.eyeR?.setAttribute('d', eyePath(50 + EYE_DX + ex, EYE_Y + ey, f.eye));
  p.eyes?.setAttribute('opacity', n(1 - f.spiral));
  const open = shine ? eyeOpenness(f.eye) : 0;
  for (const [el, side] of [
    [p.shineL, -1],
    [p.shineR, 1],
  ] as const) {
    el?.setAttribute('cx', n(50 + side * EYE_DX + ex - 0.75));
    el?.setAttribute('cy', n(EYE_Y + ey + f.eye.dy - f.eye.up * 0.42));
    el?.setAttribute('r', n(0.95 * open));
  }
  p.spirals?.setAttribute('opacity', n(f.spiral));
  p.spiralL?.setAttribute('transform', `translate(${50 - EYE_DX} ${EYE_Y}) rotate(${n(-f.spin)})`);
  p.spiralR?.setAttribute('transform', `translate(${50 + EYE_DX} ${EYE_Y}) rotate(${n(f.spin)})`);
  for (const [el, h] of [
    [p.handL, f.l],
    [p.handR, f.r],
  ] as const) {
    el?.setAttribute('cx', n(h.x));
    el?.setAttribute('cy', n(h.y));
    el?.setAttribute('r', n(Math.max(0, h.r)));
  }
  p.cheeks?.setAttribute('opacity', n(0.55 * clamp(f.cheeks)));
  p.brows?.setAttribute('opacity', n(0.75 * clamp(f.brows)));
  p.keyboard?.setAttribute('opacity', n(clamp(f.keyboard)));
  p.finger?.setAttribute('opacity', n(clamp(f.finger)));
  if (p.stars) {
    p.stars.setAttribute('opacity', n(clamp(f.stars)));
    // Três estrelinhas rodando em volta da cabeça de quem está tonto.
    Array.from(p.stars.children).forEach((star, i) => {
      const a = t * 2.6 + (i * Math.PI * 2) / 3;
      star.setAttribute('transform', `translate(${n(50 + 25 * Math.cos(a))} ${n(27 + 5 * Math.sin(a))}) scale(${n(0.7 + 0.3 * Math.sin(a))})`);
    });
  }
}

/** Manias de quando está à toa: acenar para o usuário, se espreguiçar, dar uma sacudida. */
type Fidget = 'wave' | 'stretch' | 'wiggle';
const FIDGETS: Fidget[] = ['wave', 'stretch', 'wiggle', 'wave'];
const FIDGET_SEC = 1.5;
const WAVING: { left: HandPose; right: HandPose } = { left: { x: 27, y: 62, show: 0 }, right: { x: 92, y: 43, show: 1 } };
const STRETCHING: { left: HandPose; right: HandPose } = { left: { x: 13, y: 33, show: 1 }, right: { x: 87, y: 33, show: 1 } };

/** Mola: persegue o alvo com um pouco de balanço. Passos curtos para nunca explodir. */
class Spring {
  v = 0;
  constructor(
    public x: number,
    private k = 240,
    private c = 22,
  ) {}
  to(target: number, dt: number): number {
    for (let left = dt; left > 0; left -= 0.008) {
      const h = Math.min(0.008, left);
      this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

function makeMotion(f: Frame, state: MascotState) {
  const fast = (v: number): Spring => new Spring(v, 900, 46);
  return {
    state,
    since: -1,
    bump: 0,
    y: fast(0),
    x: fast(0),
    rot: fast(0),
    sx: fast(1),
    sy: fast(1),
    jelly: new Spring(0, 300, 11),
    gx: new Spring(f.gx, 150, 19),
    gy: new Spring(f.gy, 150, 19),
    ew: new Spring(f.eye.w, 300, 24),
    eu: new Spring(f.eye.up, 300, 24),
    ed: new Spring(f.eye.down, 300, 24),
    edy: new Spring(f.eye.dy, 300, 24),
    lid: new Spring(0, 1600, 62),
    lx: new Spring(f.l.x),
    ly: new Spring(f.l.y),
    ls: new Spring(0, 260, 17),
    rx: new Spring(f.r.x),
    ry: new Spring(f.r.y),
    rs: new Spring(0, 260, 17),
    cheeks: new Spring(f.cheeks, 120, 18),
    brows: new Spring(f.brows, 120, 18),
    spiral: new Spring(f.spiral, 160, 22),
    keyboard: new Spring(0, 160, 22),
    finger: new Spring(f.finger, 160, 22),
    jumpY: 0,
    jumpV: 0,
    jumps: 0,
    nextJump: 0,
    spinFrom: -1,
    spin: 0,
    nextHop: 0,
    nextBlink: 0,
    blinkUntil: 0,
    blinkAgain: 0,
    nextGlance: 0,
    glanceUntil: 0,
    glance: { x: 0, y: 0 },
    squintUntil: 0,
    fidget: null as Fidget | null,
    fidgetFrom: 0,
    nextFidget: 0,
    peekUntil: 0,
    nextPeek: 0,
  };
}

type Motion = ReturnType<typeof makeMotion>;

/** Dá vida ao boneco: roda a cada quadro e escreve direto no SVG. Não desenha nada. */
function Animator({ parts, props }: { parts: React.RefObject<Parts>; props: RigProps }): null {
  const latest = useRef(props);
  latest.current = props;
  const first = restFrame(POSES[props.state], props.hands === 'open', false);
  const m = useRef<Motion | null>(null);
  if (!m.current) m.current = makeMotion(first, props.state);

  // Antes da primeira pintura o boneco já está na pose (sem um quadro vazio).
  useLayoutEffect(() => {
    draw(parts.current, first, props.shine, 0);
    // Só na montagem: depois disso quem desenha é o laço abaixo.
  }, []);

  useAnimationFrame((time, delta) => {
    const p = latest.current;
    const s = m.current;
    if (!s || !parts.current.body) return;
    const t = time / 1000;
    const dt = clamp(delta / 1000, 0.001, 0.05);
    const pose = POSES[p.state];
    const grounded = s.jumpY === 0 && s.jumpV === 0;
    const jump = (power: number): void => {
      if (s.jumpY !== 0 || s.jumpV !== 0) return;
      s.jumpV = -105 * power;
      s.jelly.v += 1.3 * power;
    };

    if (s.since < 0) {
      s.since = t;
      s.bump = p.bump;
      s.nextBlink = t + 1 + Math.random() * 2;
      s.nextGlance = t + 3 + Math.random() * 4;
      s.nextHop = t + 9 + Math.random() * 6;
      s.nextFidget = t + 6 + Math.random() * 8;
      s.nextPeek = t + 5 + Math.random() * 5;
    }
    if (p.state !== s.state) {
      // Toda troca de expressão dá uma sacudidinha (as calmas, quase nada).
      s.state = p.state;
      s.since = t;
      s.nextJump = t + 0.05;
      s.jumps = 0;
      s.jelly.v += CALM.includes(p.state) ? 0.35 : 0.95;
      s.fidget = null;
    }
    // À toa e sem o mouse por perto: de vez em quando faz uma graça.
    if (p.state === 'idle' && !p.look && !s.fidget && t > s.nextFidget) {
      s.fidget = FIDGETS[Math.floor(Math.random() * FIDGETS.length)];
      s.fidgetFrom = t;
      s.nextFidget = t + FIDGET_SEC + 10 + Math.random() * 14;
    }
    if (s.fidget && (t - s.fidgetFrom > FIDGET_SEC || p.state !== 'idle')) s.fidget = null;
    const fu = s.fidget ? (t - s.fidgetFrom) / FIDGET_SEC : 0;
    // Trabalhando, levanta os olhos para o usuário de vez em quando.
    if (p.state === 'working' && t > s.nextPeek) {
      s.peekUntil = t + 0.8;
      s.nextPeek = t + 7 + Math.random() * 6;
    }
    if (p.bump !== s.bump) {
      // Cutucão: pulinho e olhos apertados.
      s.bump = p.bump;
      jump(1);
      s.squintUntil = t + 0.5;
    }
    if (p.band === 'high' && p.state === 'idle' && t > s.nextHop) {
      jump(0.9);
      s.nextHop = t + 9 + Math.random() * 6;
    }
    const every = jumpEvery(p.state);
    if (every && grounded && t >= s.nextJump) {
      jump(p.state === 'celebrating' ? 1.2 : 0.8);
      s.nextJump = t + every;
      // Comemorando, um pulo sim, um não, vem com pirueta.
      if (p.state === 'celebrating' && s.jumps++ % 2 === 0) s.spinFrom = t;
    }
    // Pulo com gravidade: estica no ar, amassa ao pousar.
    if (s.jumpY !== 0 || s.jumpV !== 0) {
      s.jumpV += 560 * dt;
      s.jumpY += s.jumpV * dt;
      if (s.jumpY >= 0) {
        s.jelly.v -= Math.min(2.4, s.jumpV * 0.017);
        s.jumpY = 0;
        s.jumpV = 0;
      }
    }
    const jelly = s.jelly.to(0, dt);
    const air = Math.min(0.09, Math.abs(s.jumpV) * 0.0008);
    let spin = 0;
    if (s.spinFrom >= 0) {
      const u = (t - s.spinFrom) / 0.4;
      if (u >= 1) s.spinFrom = -1;
      else spin = 360 * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    }

    // Olhar: o mouse manda; sem ele, a pose e umas olhadelas de vez em quando.
    const free = p.state === 'idle' || p.state === 'looking';
    if (free && !p.look && t > s.nextGlance) {
      s.glance = { x: (Math.random() * 2 - 1) * 0.9, y: (Math.random() * 2 - 1) * 0.35 };
      s.glanceUntil = t + 0.7 + Math.random() * 0.9;
      s.nextGlance = s.glanceUntil + 3 + Math.random() * 5;
    }
    const glancing = free && !p.look && t < s.glanceUntil;
    const peeking = p.state === 'working' && t < s.peekUntil;
    // Pensando, o olhar passeia lá em cima.
    const drift = p.state === 'thinking' ? 0.4 * Math.sin(t * 1.3) : 0;
    const gaze = free && p.look ? p.look : s.fidget ? { x: 0, y: 0 } : glancing ? s.glance : peeking ? { x: 0, y: -0.7 } : { x: pose.gaze.x + drift, y: pose.gaze.y };
    const gx = s.gx.to(gaze.x, dt);
    const gy = s.gy.to(gaze.y, dt);

    // Olhos: forma da pose (ou apertados do cutucão), com piscada por cima.
    const shape = t < s.squintUntil || s.fidget === 'stretch' ? SQUINT : s.fidget === 'wave' ? POSES.happy.eye : peeking ? POSES.idle.eye : pose.eye;
    const canBlink = eyeOpenness(shape) > 0.5;
    if (canBlink && t > s.nextBlink) {
      s.blinkUntil = t + 0.11;
      // De vez em quando pisca duas vezes seguidas. Humor alto pisca mais (seção 6.3).
      s.blinkAgain = Math.random() < 0.2 ? t + 0.26 : 0;
      s.nextBlink = t + (p.mood >= 80 ? 1.5 : p.mood < 40 ? 3 : 2) + Math.random() * 4;
    }
    if (s.blinkAgain && t > s.blinkAgain) {
      s.blinkUntil = t + 0.11;
      s.blinkAgain = 0;
    }
    const lid = clamp(s.lid.to(canBlink && t < s.blinkUntil ? 1 : 0, dt));
    const eye: EyeShape = { w: s.ew.to(shape.w, dt), up: mix(s.eu.to(shape.up, dt), 0.3, lid), down: mix(s.ed.to(shape.down, dt), 0.3, lid), dy: s.edy.to(shape.dy, dt) };

    const move = bodyMove(p.state, p.band, t, t - s.since);
    const hands = p.hands === 'open' ? OPEN_HANDS : s.fidget === 'wave' ? WAVING : s.fidget === 'stretch' ? STRETCHING : pose;
    const wiggle = s.fidget === 'wave' ? handMove('attention', t) : handMove(p.state, t);
    // Espreguiçar estica o corpo; a sacudida balança e vai parando.
    const reach = s.fidget === 'stretch' ? 0.09 * Math.sin(Math.PI * fu) : 0;
    const shake = s.fidget === 'wiggle' ? 6 * Math.sin(fu * Math.PI * 7) * (1 - fu) : 0;
    const ls = clamp(s.ls.to(hands.left.show, dt), 0, 1.25);
    const rs = clamp(s.rs.to(hands.right.show, dt), 0, 1.25);
    const dizzy = s.spiral.to(pose.spiral ? 1 : 0, dt);
    s.spin = (s.spin + dt * 300) % 360;

    draw(
      parts.current,
      {
        x: s.x.to(move.x, dt),
        y: s.y.to(move.y, dt) + s.jumpY,
        rot: s.rot.to(move.rot + shake, dt) + gx * 1.5,
        turn: spin,
        sx: s.sx.to(move.sx - reach * 0.6, dt) * (1 - jelly * 0.8 - air * 0.6),
        sy: s.sy.to(move.sy + reach, dt) * (1 + jelly + air),
        gx,
        gy,
        eye,
        l: { x: s.lx.to(hands.left.x, dt) + wiggle.l[0] * ls, y: s.ly.to(hands.left.y, dt) + wiggle.l[1] * ls, r: HAND_R * ls },
        r: { x: s.rx.to(hands.right.x, dt) + wiggle.r[0] * rs, y: s.ry.to(hands.right.y, dt) + wiggle.r[1] * rs, r: HAND_R * rs },
        cheeks: s.cheeks.to(s.fidget === 'wave' ? 0.6 : pose.cheeks, dt),
        brows: s.brows.to(pose.brows, dt),
        spiral: dizzy,
        spin: s.spin,
        keyboard: s.keyboard.to(pose.keyboard ? 1 : 0, dt),
        finger: s.finger.to(pose.finger ? 1 : 0, dt),
        stars: dizzy,
      },
      p.shine,
      t,
    );
  });
  return null;
}

const STAR = 'M0 -3.2 L0.9 -0.9 L3.2 0 L0.9 0.9 L0 3.2 L-0.9 0.9 L-3.2 0 L-0.9 -0.9 Z';

export function Rig(props: RigProps): React.JSX.Element {
  const { state, accessories, still, bodyFill, handFill, sipping } = props;
  const parts = useRef<Parts>({ body: null, hands: null, face: null, gloss: null, eyes: null, eyeL: null, eyeR: null, shineL: null, shineR: null, spirals: null, spiralL: null, spiralR: null, handL: null, handR: null, cheeks: null, brows: null, keyboard: null, finger: null, stars: null });
  const set =
    <K extends keyof Parts>(key: K) =>
    (el: Parts[K]): void => {
      parts.current[key] = el;
    };
  // Parado (ícones pequenos): o React desenha a pose e pronto. Vivo: quem desenha é o Animator.
  const rest = restFrame(POSES[state], props.hands === 'open', false);
  useLayoutEffect(() => {
    if (still) draw(parts.current, rest, props.shine, 0);
  });
  const onFace = accessories.filter((a) => ON_FACE.includes(a));
  const onBody = accessories.filter((a) => !ON_FACE.includes(a));

  return (
    <>
      {!still && <Animator parts={parts} props={props} />}
      <g ref={set('body')}>
        {accessories.includes('cape') && <CapeBehind />}
        <rect x={18} y={32} width={64} height={48} rx={16} fill={bodyFill} />
        {/* Brilho sutil no topo do corpo */}
        <rect ref={set('gloss')} x={27} y={34.5} width={28} height={4} rx={2} fill="#FFFFFF" opacity={0.55} />
        {state === 'eating' && (still ? <ellipse cx={50} cy={37} rx={11} ry={4} fill="#18181B" /> : <motion.ellipse cx={50} cy={37} rx={11} fill="#18181B" initial={{ ry: 0 }} animate={{ ry: [3, 6, 3] }} transition={{ duration: 0.9, repeat: Infinity }} />)}

        <g ref={set('face')}>
          <g ref={set('cheeks')} fill="#F9A8C0" opacity={0}>
            <ellipse cx={32} cy={EYE_Y + 7} rx={5} ry={2.8} />
            <ellipse cx={68} cy={EYE_Y + 7} rx={5} ry={2.8} />
          </g>
          <g ref={set('eyes')} fill={INK} stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
            <path ref={set('eyeL')} />
            <path ref={set('eyeR')} />
          </g>
          <circle ref={set('shineL')} fill="#FFFFFF" opacity={0.9} />
          <circle ref={set('shineR')} fill="#FFFFFF" opacity={0.9} />
          <g ref={set('spirals')} stroke={INK} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0}>
            <g ref={set('spiralL')}>
              <path d={SPIRAL} />
            </g>
            <g ref={set('spiralR')}>
              <path d={SPIRAL} />
            </g>
          </g>
          <g ref={set('brows')} stroke={INK} strokeWidth={1.3} strokeLinecap="round" opacity={0}>
            <path d={`M${50 - EYE_DX - 3} ${EYE_Y - 7} L${50 - EYE_DX + 2.5} ${EYE_Y - 8.6}`} />
            <path d={`M${50 + EYE_DX + 3} ${EYE_Y - 7} L${50 + EYE_DX - 2.5} ${EYE_Y - 8.6}`} />
          </g>
          <AccessoriesFront items={onFace} sipping={false} />
        </g>

        <AccessoriesFront items={onBody} sipping={sipping} />

      </g>

      {/* O teclado fica no chão: não pula nem balança com o corpo. */}
      <g ref={set('keyboard')} opacity={0}>
        <rect x={24} y={81} width={52} height={9} rx={2.6} fill="#3F3F46" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={27 + i * 6} y={83} width={4.2} height={1.8} rx={0.6} fill="#71717A" />
        ))}
        <rect x={33} y={86.2} width={34} height={1.8} rx={0.8} fill="#71717A" />
      </g>

      <g ref={set('hands')} fill={handFill} stroke="rgba(0,0,0,0.16)" strokeWidth={0.6}>
        <g ref={set('finger')} opacity={0}>
          <rect x={47.5} y={62} width={5} height={12} rx={2.5} />
        </g>
        <circle ref={set('handL')} />
        <circle ref={set('handR')} />
      </g>

      <g ref={set('stars')} fill="#FDE68A" opacity={0}>
        <path d={STAR} />
        <path d={STAR} />
        <path d={STAR} />
      </g>
    </>
  );
}
