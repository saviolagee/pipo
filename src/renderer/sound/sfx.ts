// Efeitos sonoros sintetizados com Web Audio (seção 10). Sem arquivos de áudio.
import type { SfxName } from '@shared/ipc-contract';

let ctx: AudioContext | null = null;
let volume = 0.6;
let muted = false;

export function configureSfx(v: number, m: boolean): void {
  volume = v;
  muted = m;
}

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function out(c: AudioContext, gain: number): GainNode {
  const g = c.createGain();
  g.gain.value = gain * volume;
  g.connect(c.destination);
  return g;
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, start: number, dur: number, gain: number): void {
  const o = c.createOscillator();
  const g = out(c, 0);
  o.type = type;
  o.frequency.setValueAtTime(f0, start);
  o.frequency.exponentialRampToValueAtTime(f1, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain * volume, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  o.start(start);
  o.stop(start + dur + 0.02);
}

const sounds: Record<SfxName, (c: AudioContext) => void> = {
  // Clique: seno 660→880 Hz, 80ms.
  pop: (c) => tone(c, 'sine', 660, 880, c.currentTime, 0.08, 0.35),
  // Concluído: 784 + 1047 Hz, 250ms.
  chime: (c) => {
    const t = c.currentTime;
    tone(c, 'sine', 784, 784, t, 0.25, 0.25);
    tone(c, 'sine', 1047, 1047, t + 0.07, 0.25, 0.22);
  },
  // Atenção: triângulo 520 Hz, 2 pulsos.
  alert: (c) => {
    const t = c.currentTime;
    tone(c, 'triangle', 520, 520, t, 0.11, 0.35);
    tone(c, 'triangle', 520, 520, t + 0.16, 0.11, 0.35);
  },
  // Arquivo engolido: ruído filtrado descendente, 150ms.
  gulp: (c) => {
    const t = c.currentTime;
    const len = Math.floor(c.sampleRate * 0.15);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.15);
    f.Q.value = 6;
    const g = out(c, 0.5);
    src.connect(f);
    f.connect(g);
    src.start(t);
  },
  // Tonto: seno com vibrato, 400ms.
  boing: (c) => {
    const t = c.currentTime;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    const g = out(c, 0);
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.4);
    lfo.frequency.value = 18;
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.42);
    lfo.stop(t + 0.42);
  },
  // Captura salva: 30ms.
  tick: (c) => tone(c, 'square', 1400, 1200, c.currentTime, 0.03, 0.12),
};

export function play(name: SfxName): void {
  if (muted || volume <= 0) return;
  try {
    sounds[name](ac());
  } catch {
    // Áudio indisponível (ex.: sem dispositivo de saída).
  }
}
