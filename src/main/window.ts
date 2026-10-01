import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { WINDOW } from '@shared/config';
import { attachWindow, emit, getWindow } from './bus';

const isMac = process.platform === 'darwin';

function targetBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const { workArea, bounds } = display;
  return {
    x: Math.round(workArea.x + (workArea.width - WINDOW.width) / 2),
    // Colado na borda superior da tela (em cima da barra de menus no macOS).
    y: bounds.y,
    width: WINDOW.width,
    height: WINDOW.height,
  };
}

export function createNotchWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...targetBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'Pipo',
    // NSPanel não ativa o app ao receber clique (não rouba o foco da janela do usuário).
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac) win.setWindowButtonVisibility?.(false);
  // Por padrão o clique atravessa; o renderer liga a interação quando o mouse entra no notch.
  win.setIgnoreMouseEvents(true, { forward: true });

  const reposition = (): void => {
    if (!win.isDestroyed()) win.setBounds(targetBounds());
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  win.once('ready-to-show', () => {
    win.showInactive();
    reposition();
  });

  // Bloqueia navegação acidental (ex.: soltar um arquivo fora da zona de drop).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  attachWindow(win);
  return win;
}

let interactive = false;

export function setInteractive(on: boolean): void {
  const win = getWindow();
  if (!win || interactive === on) return;
  interactive = on;
  if (on) {
    win.setIgnoreMouseEvents(false);
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

/** Traz o notch à frente e expande; foca a janela quando há digitação. */
export function showNotch(focus: boolean): void {
  const win = getWindow();
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  if (focus) {
    setInteractive(true);
    win.focus();
    win.webContents.focus();
  }
}

export function toggleNotch(): void {
  showNotch(true);
  emit('ui:toggle', null);
}
