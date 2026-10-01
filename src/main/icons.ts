// Rasteriza o rosto do mascote (squircle + dois olhos) em PNG, sem depender de imagens.
// Usado no tray/menu bar [Ref 10] e para gerar os ícones do app (scripts/gen-icons.ts).
import { deflateSync } from 'node:zlib';

export interface FaceOptions {
  size: number;
  /** 'mono': silhueta preta com olhos vazados (template do macOS). 'light': corpo branco, olhos pretos. */
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

function sdEllipse(px: number, py: number, rx: number, ry: number): number {
  // Aproximação suficiente para olhos pequenos.
  const k = Math.hypot(px / rx, py / ry);
  return (k - 1) * Math.min(rx, ry);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function renderFace(opts: FaceOptions): Buffer {
  const { size, style } = opts;
  const out = new Uint8Array(size * size * 4);
  const S = 4; // supersampling
  const cx = size / 2;
  const cy = size / 2;
  const scale = opts.background ? size * 0.62 : size * 0.94;
  const hw = scale / 2;
  const hh = (scale / 1.15) / 2;
  const r = hh * 0.62;
  const eyeRx = scale * 0.075;
  const eyeRy = scale * 0.12;
  const eyeDx = scale * 0.2;
  const eyeY = scale * 0.06;
  const bgR = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let body = 0;
      let eye = 0;
      let bg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S - cx;
          const py = y + (sy + 0.5) / S - cy;
          if (sdRoundRect(px, py, hw, hh, r) <= 0) body++;
          if (sdEllipse(px - eyeDx, py - eyeY, eyeRx, eyeRy) <= 0 || sdEllipse(px + eyeDx, py - eyeY, eyeRx, eyeRy) <= 0) eye++;
          if (opts.background && sdRoundRect(px, py, size / 2, size / 2, bgR) <= 0) bg++;
        }
      }
      const n = S * S;
      const b = body / n;
      const e = Math.min(eye, body) / n;
      const g = bg / n;
      const i = (y * size + x) * 4;
      if (style === 'mono' || style === 'mono-white') {
        const a = clamp01(b - e);
        const c = style === 'mono' ? 0 : 255;
        out[i] = c;
        out[i + 1] = c;
        out[i + 2] = c;
        out[i + 3] = Math.round(a * 255);
      } else {
        // Corpo branco levemente acinzentado embaixo, olhos pretos, fundo opcional.
        const shade = 255 - Math.round(((y - (cy - hh)) / (2 * hh)) * 22);
        const bodyRGB = [shade, shade, Math.min(255, shade + 5)];
        const bgRGB = opts.background ?? [0, 0, 0];
        const bodyOnly = b - e;
        const fgA = clamp01(b);
        const baseA = opts.background ? g : 0;
        const a = clamp01(fgA + baseA * (1 - fgA));
        for (let ch = 0; ch < 3; ch++) {
          const fg = fgA > 0 ? (bodyRGB[ch] * bodyOnly + 10 * e) / fgA : 0;
          const v = a > 0 ? (fg * fgA + bgRGB[ch] * baseA * (1 - fgA)) / a : 0;
          out[i + ch] = Math.round(v);
        }
        out[i + 3] = Math.round(a * 255);
      }
    }
  }
  return encodePng(size, size, out);
}
