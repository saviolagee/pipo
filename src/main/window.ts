import { join } from 'node:path';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { MINI, WINDOW } from '@shared/config';
import { attachWindow, emit, getWindow } from './bus';
import { getSettings, patchSettings } from './db/repos/settings';

const isMac = process.platform === 'darwin';

/** O notch está aberto? (o renderer avisa). No modo miniatura, a janela só fica no canto enquanto recolhida. */
let expanded = false;

function topBounds(): Electron.Rectangle {
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

/** Canto inferior direito da área útil: logo acima do relógio da barra de tarefas. */
function miniBounds(): Electron.Rectangle {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - MINI.window - MINI.margin,
    y: workArea.y + workArea.height - MINI.window - MINI.margin,
    width: MINI.window,
    height: MINI.window,
  };
}

function isMini(): boolean {
  try {
    return getSettings().mini;
  } catch {
    // Banco ainda não aberto (criação da janela).
    return false;
  }
}

function targetBounds(): Electron.Rectangle {
  return isMini() && !expanded ? miniBounds() : topBounds();
}

function applyBounds(): void {
  const win = getWindow();
  if (!win) return;
  const next = targetBounds();
  const cur = win.getBounds();
  if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return;
  // A janela não é redimensionável pelo usuário; para mudar o tamanho por código, libera um instante.
  win.setResizable(true);
  win.setBounds(next);
  win.setResizable(false);
}

/** Liga ou desliga o modo miniatura (atalho, bandeja e botão do notch chegam aqui). */
export function setMini(on: boolean): void {
  patchSettings({ mini: on });
  applyBounds();
  emit('ui:mini', on);
  miniHooks.changed();
}

export function toggleMini(): void {
  setMini(!isMini());
}

/** A bandeja atualiza o item "Modo miniatura" por aqui. */
export const miniHooks: { changed: () => void } = { changed: () => undefined };

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
    if (!win.isDestroyed()) applyBounds();
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  ipcMain.on('ui:expandedChanged', (e, on: boolean) => {
    if (e.sender !== win.webContents) return;
    expanded = on;
    reposition();
  });

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
