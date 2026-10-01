// Teste de fumaça do app empacotado: abre o executável, espera a janela renderizar, tira uma
// captura (PIPO_E2E=1 libera a captura no build empacotado) e confere que o app fechou sozinho.
// Uso: node scripts/smoke.mjs [pasta dist]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const candidates = {
  win32: () => [join(dist, 'win-unpacked', 'Pipo.exe')],
  darwin: () => readdirSync(dist).filter((d) => d.startsWith('mac')).map((d) => join(dist, d, 'Pipo.app', 'Contents', 'MacOS', 'Pipo')),
  linux: () => [join(dist, 'linux-unpacked', 'pipo'), join(dist, 'linux-unpacked', 'Pipo')],
}[process.platform];
const bin = (candidates?.() ?? []).find((p) => existsSync(p));
if (!bin) {
  console.error(`Executável não encontrado em ${dist}.`);
  process.exit(1);
}
const home = mkdtempSync(join(tmpdir(), 'pipo-smoke-'));
const out = join(home, 'smoke.png');
const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
console.log(`Abrindo ${bin}`);
const r = spawnSync(bin, args, {
  env: { ...process.env, PIPO_E2E: '1', PIPO_CAPTURE: out, PIPO_CAPTURE_DELAY: '4000', PIPO_USER_DATA: join(home, 'data') },
  timeout: 90_000,
  encoding: 'utf8',
});
if (r.error) {
  console.error('Falhou ao abrir:', r.error.message);
  process.exit(1);
}
if (!existsSync(out) || statSync(out).size < 1000) {
  console.error('O app não renderizou a janela.', r.stdout?.slice(-2000), r.stderr?.slice(-2000));
  process.exit(1);
}
console.log(`OK: janela renderizada (${statSync(out).size} bytes), saída ${r.status}.`);
