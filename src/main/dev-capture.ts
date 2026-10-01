// Captura de tela para validação visual em desenvolvimento (não roda em produção).
// PIPO_CAPTURE=saida.png  PIPO_CAPTURE_DELAY=ms  PIPO_CAPTURE_SCRIPT="js no renderer"
import { writeFileSync } from 'node:fs';
import { app } from 'electron';
import { getWindow } from './bus';

export function maybeDevCapture(): void {
  const out = process.env.PIPO_CAPTURE;
  if (!out || app.isPackaged) return;
  const delay = Number(process.env.PIPO_CAPTURE_DELAY ?? 2500);
  const steps = (process.env.PIPO_CAPTURE_SCRIPT ?? '').split('\n@@\n').filter(Boolean);
  const win = getWindow();
  if (!win) return;
  win.webContents.once('did-finish-load', async () => {
    // Fundo tipo papel de parede para avaliar glow e transparência.
    await win.webContents.executeJavaScript(
      "document.documentElement.style.background='radial-gradient(120% 90% at 70% 100%, #2b4bd8 0%, #10164a 45%, #0b0d1c 100%)'",
      true,
    );
    await new Promise((r) => setTimeout(r, delay));
    let i = 0;
    for (const step of steps) {
      try {
        await win.webContents.executeJavaScript(step, true);
      } catch (e) {
        console.error('[capture] script falhou:', e);
      }
      await new Promise((r) => setTimeout(r, Number(process.env.PIPO_CAPTURE_STEP_DELAY ?? 1200)));
      if (process.env.PIPO_CAPTURE_EACH) {
        const img = await win.webContents.capturePage();
        writeFileSync(out.replace(/\.png$/, `-${++i}.png`), img.toPNG());
      }
    }
    const img = await win.webContents.capturePage();
    writeFileSync(out, img.toPNG());
    console.log('[capture] salvo em', out);
    app.exit(0);
  });
}
