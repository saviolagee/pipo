// O boneco do mascote. O desenho (SVG) é um só; quando ele está "vivo", um laço por quadro leva
// cada parte até a pose da expressão com molas e gravidade: pálpebras e boca que mudam de forma,
// língua que entra e sai, mãos, pulo que estica no ar e amassa ao pousar, piscadas e olhadelas.
import { useAnimationFrame } from 'motion/react';
import { useId, useLayoutEffect, useRef } from 'react';
import type { Accessory, MascotState } from '@shared/types';
import { AccessoriesFront, CapeBehind } from '../Accessories';
import type { MoodBand } from '../mood';
import { BODY, bodyMove, EYE_Y, eyeOpenness, handMove, jumpEvery, OPEN_HANDS, POSES, SPIRAL, SQUINT, type EyeShape, type HandPose, type MouthShape } from './poses';
import { CALM, clamp, draw, HAND_R, INK, mix, NO_PARTS, ON_FACE, PUPIL_R, restFrame, SCLERA, TONGUE, type Frame, type Parts } from './frame';

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
  /** Espessura do traço (mais grosso nos tamanhos pequenos, para continuar legível). */
  ink: number;
}

/** Manias de quando está à toa: acenar para o usuário, se espreguiçar, dar uma sacudida. */
type Fidget = 'wave' | 'stretch' | 'wiggle';
const FIDGETS: Fidget[] = ['wave', 'stretch', 'wiggle', 'wave'];
const FIDGET_SEC = 1.5;
const WAVING: { left: HandPose; right: HandPose } = { left: { x: 31, y: 64, show: 0 }, right: { x: 90, y: 44, show: 1 } };
const STRETCHING: { left: HandPose; right: HandPose } = { left: { x: 14, y: 34, show: 1 }, right: { x: 86, y: 34, show: 1 } };

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
  const soft = (v: number): Spring => new Spring(v, 300, 24);
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
    ew: soft(f.eye.w),
    eu: soft(f.eye.up),
    ed: soft(f.eye.down),
    edy: soft(f.eye.dy),
    et: soft(f.eye.tilt),
    es: soft(f.eye.skew),
    mw: soft(f.mouth.w),
    mc: soft(f.mouth.curve),
    mo: soft(f.mouth.open),
    // A língua sai com um balancinho.
    mt: new Spring(f.mouth.tongue, 260, 13),
    lid: new Spring(0, 1600, 62),
    lx: new Spring(f.l.x),
    ly: new Spring(f.l.y),
    ls: new Spring(0, 260, 17),
    rx: new Spring(f.r.x),
    ry: new Spring(f.r.y),
    rs: new Spring(0, 260, 17),
    cheeks: new Spring(f.cheeks, 120, 18),
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
  const first = restFrame(POSES[props.state], props.hands === 'open');
  const m = useRef<Motion | null>(null);
  if (!m.current) m.current = makeMotion(first, props.state);

  // Antes da primeira pintura o boneco já está na pose (sem um quadro vazio).
  useLayoutEffect(() => {
    draw(parts.current, first, 0);
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
    const waving = s.fidget === 'wave';
    const shape = t < s.squintUntil || s.fidget === 'stretch' ? SQUINT : waving ? POSES.happy.eye : peeking ? POSES.looking.eye : pose.eye;
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
    const eye: EyeShape = { w: s.ew.to(shape.w, dt), up: mix(s.eu.to(shape.up, dt), 0.15, lid), down: mix(s.ed.to(shape.down, dt), 0.3, lid), dy: s.edy.to(shape.dy, dt), tilt: s.et.to(shape.tilt, dt), skew: s.es.to(shape.skew, dt) };
    const mouthTo = waving ? POSES.happy.mouth : pose.mouth;
    const mouth: MouthShape = { w: s.mw.to(mouthTo.w, dt), curve: s.mc.to(mouthTo.curve, dt), open: Math.max(0, s.mo.to(mouthTo.open, dt)), tongue: s.mt.to(mouthTo.tongue, dt) };

    const move = bodyMove(p.state, p.band, t, t - s.since);
    const hands = p.hands === 'open' ? OPEN_HANDS : waving ? WAVING : s.fidget === 'stretch' ? STRETCHING : pose;
    const wiggle = waving ? handMove('attention', t) : handMove(p.state, t);
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
        mouth,
        l: { x: s.lx.to(hands.left.x, dt) + wiggle.l[0] * ls, y: s.ly.to(hands.left.y, dt) + wiggle.l[1] * ls, r: HAND_R * ls },
        r: { x: s.rx.to(hands.right.x, dt) + wiggle.r[0] * rs, y: s.ry.to(hands.right.y, dt) + wiggle.r[1] * rs, r: HAND_R * rs },
        cheeks: s.cheeks.to(waving ? 0.6 : pose.cheeks, dt),
        spiral: dizzy,
        spin: s.spin,
        keyboard: s.keyboard.to(pose.keyboard ? 1 : 0, dt),
        finger: s.finger.to(pose.finger ? 1 : 0, dt),
        stars: dizzy,
      },
      t,
    );
  });
  return null;
}

const STAR = 'M0 -3.2 L0.9 -0.9 L3.2 0 L0.9 0.9 L0 3.2 L-0.9 0.9 L-3.2 0 L-0.9 -0.9 Z';

export function Rig(props: RigProps): React.JSX.Element {
  const { state, accessories, still, bodyFill, sipping, ink } = props;
  const uid = useId().replace(/:/g, '');
  const parts = useRef<Parts>({ ...NO_PARTS });
  const set =
    (key: keyof Parts) =>
    (el: SVGElement | null): void => {
      parts.current[key] = el;
    };
  // Parado (ícones pequenos): o React desenha a pose e pronto. Vivo: quem desenha é o Animator.
  const rest = restFrame(POSES[state], props.hands === 'open');
  useLayoutEffect(() => {
    if (still) draw(parts.current, rest, 0);
  });
  const onFace = accessories.filter((a) => ON_FACE.includes(a));
  const onBody = accessories.filter((a) => !ON_FACE.includes(a));

  return (
    <>
      {!still && <Animator parts={parts} props={props} />}
      <defs>
        <clipPath id={`eyeL-${uid}`}>
          <path ref={set('clipL')} />
        </clipPath>
        <clipPath id={`eyeR-${uid}`}>
          <path ref={set('clipR')} />
        </clipPath>
      </defs>
      <g ref={set('body')}>
        {accessories.includes('cape') && <CapeBehind />}
        <path d={BODY} fill={bodyFill} stroke={INK} strokeWidth={ink * 1.25} strokeLinejoin="round" />

        <g ref={set('face')}>
          <g ref={set('cheeks')} fill="#F9A8C0" opacity={0}>
            <ellipse cx={30.5} cy={EYE_Y + 10} rx={4.6} ry={2.6} />
            <ellipse cx={69.5} cy={EYE_Y + 10} rx={4.6} ry={2.6} />
          </g>
          <g ref={set('eyes')}>
            <g fill={SCLERA} stroke={INK} strokeWidth={ink} strokeLinejoin="round">
              <path ref={set('eyeL')} />
              <path ref={set('eyeR')} />
            </g>
            <circle ref={set('pupilL')} r={PUPIL_R} fill={INK} clipPath={`url(#eyeL-${uid})`} />
            <circle ref={set('pupilR')} r={PUPIL_R} fill={INK} clipPath={`url(#eyeR-${uid})`} />
            {/* A pálpebra de cima é o traço mais forte do rosto. */}
            <g fill="none" stroke={INK} strokeWidth={ink * 1.5} strokeLinecap="round">
              <path ref={set('lidL')} />
              <path ref={set('lidR')} />
            </g>
          </g>
          <g ref={set('spirals')} stroke={INK} strokeWidth={ink} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0}>
            <g ref={set('spiralL')}>
              <path d={SPIRAL} />
            </g>
            <g ref={set('spiralR')}>
              <path d={SPIRAL} />
            </g>
          </g>
          <g ref={set('tongue')} stroke={INK} strokeWidth={ink * 0.9} strokeLinejoin="round" strokeLinecap="round">
            <path ref={set('tongueBody')} fill={TONGUE} />
            <path ref={set('tongueLine')} fill="none" strokeWidth={ink * 0.7} />
          </g>
          <path ref={set('mouth')} stroke={INK} strokeWidth={ink * 1.25} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <ellipse ref={set('inside')} cx={50} fill={TONGUE} opacity={0} />
          <AccessoriesFront items={onFace} sipping={false} />
        </g>

        <AccessoriesFront items={onBody} sipping={sipping} />
      </g>

      {/* O teclado fica no chão: não pula nem balança com o corpo. */}
      <g ref={set('keyboard')} opacity={0}>
        <rect x={24} y={86} width={52} height={9} rx={2.6} fill="#3F3F46" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={27 + i * 6} y={88} width={4.2} height={1.8} rx={0.6} fill="#71717A" />
        ))}
        <rect x={33} y={91.2} width={34} height={1.8} rx={0.8} fill="#71717A" />
      </g>

      <g ref={set('hands')} fill={bodyFill} stroke={INK} strokeWidth={ink}>
        <g ref={set('finger')} opacity={0}>
          <rect x={47.5} y={63} width={5} height={13} rx={2.5} />
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
