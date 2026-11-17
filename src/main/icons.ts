// Rasteriza o rosto do mascote (a bola de olhar de canto, boca reta e língua de fora) em PNG, sem
// depender de imagens.
// Usado no tray/menu bar [Ref 10] e para gerar os ícones do app (scripts/gen-icons.ts).
import { deflateSync } from 'node:zlib';

export interface FaceOptions {
  size: number;
  /** 'mono': silhueta preta com o rosto vazado (template do macOS). 'mono-white': a mesma, branca. 'color': o Pipo branco. */
  style: 'mono' | 'mono-white' | 'color';
  /** Fundo opcional (ícone do app). */
  background?: [number, number, number] | null;
}

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distância assinada de um retângulo arredondado centrado na origem. */
function sdRoundRect(px: number, py: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px) - hw + r;
  const qy = Math.abs(py) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// O rosto, nas mesmas medidas do mascote (viewBox 0..100, bola com centro em 50,57).
const FACE = { cx: 50, cy: 57, rx: 28.2, ry: 26.8, dx: 0.9, eyeY: 51.9, eyeDx: 10.7, w: 8.6, up: 0.4, down: 7.6, tilt: 0.9, skew: 0.5, pupil: 3.2, gaze: 2.2, mouthY: 70, mouthW: 10.5, tongueX: 6.3, tongueH: 6.2 };

type Part = 'none' | 'body' | 'ink' | 'eye' | 'tongue';

/**
 * O que há num ponto do rosto. `line` é a espessura do traço (mais grosso em ícones pequenos) e
 * `zoom` aumenta olhos e boca dentro da bola, para o rosto continuar legível em 16 px.
 */
function partAt(x0: number, y0: number, line: number, zoom: number): Part {
  const f = FACE;
  const k = Math.hypot((x0 - f.cx) / f.rx, (y0 - f.cy) / f.ry);
  if (k > 1) return 'none';
  if ((1 - k) * Math.min(f.rx, f.ry) < line * 1.2) return 'ink';
  const x = f.cx + (x0 - f.cx) / zoom;
  const y = 60 + (y0 - 60) / zoom;
  const ink = line / zoom;
  const fx = x - f.dx;
  for (const side of [-1, 1]) {
    const cx = f.cx + side * f.eyeDx;
    const u = (fx - (cx - f.w)) / (2 * f.w);
    if (u < -0.08 || u > 1.08) continue;
    const tilt = (f.tilt + (side < 0 ? f.skew : -f.skew)) * -side;
    // Canto esquerdo e direito do olho (o de fora é mais alto) e as duas bordas, em curva.
    const yl = f.eyeY - tilt;
    const yr = f.eyeY + tilt;
    const uu = Math.max(0, Math.min(1, u));
    const edge = (mid: number): number => (1 - uu) * (1 - uu) * yl + 2 * uu * (1 - uu) * mid + uu * uu * yr;
    const top = edge(f.eyeY - 2 * f.up);
    const bottom = edge(f.eyeY + 2 * f.down);
    if (Math.abs(y - top) < ink * 0.85 && u > -0.05 && u < 1.05) return 'ink';
    if (u < 0 || u > 1 || y < top || y > bottom) continue;
    if (bottom - y < ink * 0.6) return 'ink';
    return Math.hypot(fx - (cx + f.gaze), y - (f.eyeY + 3)) < f.pupil ? 'ink' : 'eye';
  }
  if (Math.abs(y - f.mouthY) < ink * 0.65 && Math.abs(fx - f.cx) < f.mouthW) return 'ink';
  const t = sdRoundRect(fx - (f.cx + f.tongueX), y - (f.mouthY + f.tongueH / 2 - 1.5), 3, f.tongueH / 2 + 1.5, 3);
  if (y > f.mouthY && t < 0) return t > -ink * 0.55 ? 'ink' : 'tongue';
  return 'body';
}

const COLORS: Record<Exclude<Part, 'none'>, [number, number, number]> = { body: [255, 255, 255], ink: [10, 10, 11], eye: [255, 241, 168], tongue: [244, 163, 160] };

export function renderFace(opts: FaceOptions): Buffer {
  const { size, style } = opts;
  const out = new Uint8Array(size * size * 4);
  const S = 4; // supersampling
  // A bola ocupa quase tudo; com fundo (ícone do app), sobra margem.
  const diameter = size * (opts.background ? (size <= 32 ? 0.84 : 0.7) : 0.97);
  const unit = diameter / (FACE.rx * 2);
  const ink = Math.max(1.6, 1.15 / unit);
  const zoom = diameter < 28 ? 1.25 : diameter < 48 ? 1.12 : 1;
  const bgR = size * 0.22;
  const mono = style !== 'color';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S - size / 2;
          const py = y + (sy + 0.5) / S - size / 2;
          const part = partAt(px / unit + FACE.cx, py / unit + FACE.cy, ink, zoom);
          let c: [number, number, number] | null = null;
          if (mono) {
            // Silhueta: o corpo cheio, com olhos, boca e contorno da língua vazados.
            if (part === 'body' || part === 'tongue') c = style === 'mono' ? [0, 0, 0] : [255, 255, 255];
            else if (part === 'ink' && Math.hypot((px / unit) / FACE.rx, (py / unit) / FACE.ry) > 0.9) c = style === 'mono' ? [0, 0, 0] : [255, 255, 255];
          } else if (part !== 'none') c = COLORS[part];
          else if (opts.background && sdRoundRect(px, py, size / 2, size / 2, bgR) <= 0) c = opts.background;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            alpha++;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (alpha) {
        out[i] = Math.round(r / alpha);
        out[i + 1] = Math.round(g / alpha);
        out[i + 2] = Math.round(b / alpha);
        out[i + 3] = Math.round((alpha / (S * S)) * 255);
      }
    }
  }
  return encodePng(size, size, out);
}
