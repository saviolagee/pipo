// Pipo em tela cheia: uma janela normal (barra de título, minimizar, maximizar, barra de tarefas) com
// as mesmas telas do notch em tamanho grande. O notch continua no topo; os dados são os mesmos.
import { join } from 'node:path';
import { BrowserWindow, nativeImage } from 'electron';
import { attachFullWindow, getFullWindow } from './bus';
import { renderFace } from './icons';

export function openAppWindow(tab?: string): void {
  const cur = getFullWindow();
  if (cur) {
    if (tab) cur.webContents.send('app:navigate', { tab });
    if (cur.isMinimized()) cur.restore();
    cur.show();
    cur.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0B0B0D',
    title: 'Pipo',
    icon: nativeImage.createFromBuffer(renderFace({ size: 256, style: 'color', background: [24, 24, 28] })),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  // Abre ocupando a tela (maximizada); F11 vira tela cheia de verdade, sem a barra de título.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.on('closed', () => attachFullWindow(null));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const query = { view: 'app', ...(tab ? { tab } : {}) };
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query).toString()}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
  attachFullWindow(win);
}
