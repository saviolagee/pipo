// Gera os ícones do app a partir do desenho do mascote (mesmo rasterizador do tray).
// Uso: node --experimental-strip-types scripts/gen-icons.mts
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderFace } from '../src/main/icons.ts';

mkdirSync('build/icons', { recursive: true });
const bg: [number, number, number] = [10, 10, 12];
writeFileSync('build/icon.png', renderFace({ size: 1024, style: 'color', background: bg }));
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(`build/icons/${size}x${size}.png`, renderFace({ size, style: 'color', background: bg }));
}
// Template monocromático do tray (macOS) para referência no repositório.
writeFileSync('build/trayTemplate.png', renderFace({ size: 18, style: 'mono' }));
writeFileSync('build/trayTemplate@2x.png', renderFace({ size: 36, style: 'mono' }));
console.log('ícones gerados em build/');
