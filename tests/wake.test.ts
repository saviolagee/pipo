import { describe, expect, it } from 'vitest';
import { decideWake, SpeechSegmenter, wakeFloor, wakePhrases } from '../src/shared/wake';

// As notas abaixo são as medidas com fala sintética (voz pt-BR do Windows) no Whisper base.
describe('chamar por voz: a decisão pelas notas do modelo', () => {
  it('"Pipo" nítido e a fala acabou: chama o branco', () => {
    expect(decideWake({ wake: -4.0, end: -1.0, names: [] })).toEqual({ kind: 'white' });
    // Nome testado, mas com nota de quem não foi dito.
    expect(decideWake({ wake: -3.0, end: -0.6, names: [{ id: 1, score: -4.2 }] })).toEqual({ kind: 'white' });
  });

  it('"Pipo" e um nome: chama aquele Pipo; entre dois nomes, o de nota maior', () => {
    expect(decideWake({ wake: -3.2, end: -4.3, names: [{ id: 2, score: -0.33 }] })).toEqual({ kind: 'pipo', id: 2 });
    expect(decideWake({ wake: -3.2, end: -6.0, names: [{ id: 3, score: -1.09 }, { id: 1, score: -0.53 }] })).toEqual({ kind: 'pipo', id: 1 });
  });

  it('"Pipo" menos nítido só vale se um nome veio claro logo depois', () => {
    expect(decideWake({ wake: -6.3, end: -2.5, names: [{ id: 4, score: -1.72 }] })).toEqual({ kind: 'pipo', id: 4 });
    expect(decideWake({ wake: -6.3, end: -0.7, names: [] })).toBeNull();
    expect(decideWake({ wake: -6.3, end: -0.7, names: [{ id: 4, score: -4.0 }] })).toBeNull();
  });

  it('palavras parecidas e fala qualquer não são chamado', () => {
    // people, pico, tipo, pessoa; e "tipo o editor de vídeo" (nome claro, mas sem "Pipo" antes).
    for (const wake of [-6.07, -6.69, -10.02, -18.05]) expect(decideWake({ wake, end: -0.9, names: [] }), String(wake)).toBeNull();
    expect(decideWake({ wake: -11.01, end: -8.7, names: [{ id: 1, score: -0.19 }] })).toBeNull();
  });

  it('a sensibilidade muda a nota mínima: alta atende um "Pipo" menos nítido, baixa exige mais', () => {
    const slow = { wake: -6.08, end: -0.94, names: [] };
    expect(decideWake(slow, 'low')).toBeNull();
    expect(decideWake(slow, 'normal')).toBeNull();
    expect(decideWake(slow, 'high')).toEqual({ kind: 'white' });
    const clear = { wake: -5.4, end: -0.9, names: [] };
    expect(decideWake(clear, 'low')).toBeNull();
    expect(decideWake(clear, 'normal')).toEqual({ kind: 'white' });
    // O piso a partir do qual nada é calculado acompanha a sensibilidade.
    expect([wakeFloor('low'), wakeFloor('normal'), wakeFloor('high')]).toEqual([-7, -8, -9]);
  });

  it('jeitos de dizer o nome: inteiro e cada palavra forte, como escrito e em minúsculas', () => {
    expect(wakePhrases('Editor de Vídeo')).toEqual([' Editor de Vídeo', ' editor de vídeo', ' Editor', ' editor', ' Vídeo', ' vídeo']);
    expect(wakePhrases('  prospector ')).toEqual([' prospector']);
    expect(wakePhrases('Zé')).toEqual([' Zé', ' zé']);
    expect(wakePhrases('')).toEqual([]);
  });
});

const RATE = 16000;
const FRAME = 1024;

/** Blocos de áudio: um tom na amplitude pedida (0 = quase silêncio). */
function audio(ms: number, amp: number): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let n = Math.round((ms / 1000) * RATE); n > 0; n -= FRAME) {
    const f = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) f[i] = (amp || 0.001) * Math.sin((2 * Math.PI * 220 * i) / RATE);
    frames.push(f);
  }
  return frames;
}

function run(parts: Float32Array[][]): number[] {
  const seg = new SpeechSegmenter({ sampleRate: RATE });
  const out: number[] = [];
  for (const frame of parts.flat()) {
    const speech = seg.feed(frame);
    if (speech) out.push(Math.round((speech.length / RATE) * 10) / 10);
  }
  return out;
}

describe('chamar por voz: o recorte das falas', () => {
  it('uma fala curta entre silêncios sai inteira, uma vez', () => {
    const out = run([audio(1000, 0), audio(700, 0.2), audio(1200, 0)]);
    expect(out).toHaveLength(1);
    // A fala, mais o trecho guardado antes dela e o silêncio que a encerrou.
    expect(out[0]).toBeGreaterThanOrEqual(0.7);
    expect(out[0]).toBeLessThanOrEqual(1.8);
  });

  it('um estalo curto não vira fala', () => {
    expect(run([audio(1000, 0), audio(60, 0.5), audio(1200, 0)])).toEqual([]);
  });

  it('conversa longa é descartada, e a escuta volta depois do silêncio', () => {
    const out = run([audio(500, 0), audio(6000, 0.2), audio(1000, 0), audio(600, 0.2), audio(1200, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeLessThanOrEqual(1.8);
  });

  it('com ruído constante (ventilador), o piso se ajusta e uma fala por cima ainda é recortada', () => {
    const out = run([audio(500, 0), audio(20_000, 0.03), audio(700, 0.4), audio(1500, 0.03)]);
    expect(out).toHaveLength(1);
  });

  it('só silêncio não produz nada', () => {
    expect(run([audio(5000, 0)])).toEqual([]);
  });
});
