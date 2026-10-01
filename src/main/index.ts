import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import { APP_ID, APP_NAME } from '@shared/config';
import { emit } from './bus';
import { registerBootstrapIpc } from './bootstrap';
import { openDb } from './db';
import { getSettings, patchSettings } from './db/repos/settings';
import { maybeDevCapture } from './dev-capture';
import { handle } from './ipc';
import { registerShortcuts, setFixedShortcuts, unregisterShortcuts } from './shortcuts';
import { createTray, setPaused } from './tray';
import { createNotchWindow, setInteractive, showNotch, toggleNotch } from './window';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (process.platform === 'linux') {
  // Janelas transparentes no Linux (útil para desenvolvimento).
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

export const paths = {
  get userData(): string {
    return app.getPath('userData');
  },
  get files(): string {
    return join(app.getPath('userData'), 'files');
  },
  get workspace(): string {
    return join(app.getPath('userData'), 'agent-workspace');
  },
};

function registerCoreIpc(): void {
  handle('window:setInteractive', (on) => setInteractive(on));
  handle('window:setExpanded', () => undefined);
  handle('app:quit', () => app.quit());
  handle('settings:get', () => getSettings());
  handle('settings:patch', (patch) => {
    const next = patchSettings(patch);
    if (patch.shortcuts) registerShortcuts();
    if (patch.paused !== undefined) setPaused(patch.paused);
    return next;
  });
  handle('cards:respond', () => undefined);
  handle('debug:simulate', () => undefined);
  ipcMain.on('ui:ready', () => undefined);
}

app.whenReady().then(() => {
  mkdirSync(paths.files, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  openDb(join(paths.userData, 'pipo.db'));

  if (process.platform === 'darwin') app.dock?.hide();

  registerCoreIpc();
  registerBootstrapIpc();
  createNotchWindow();
  createTray();
  // Painel de debug do mascote (Ctrl+Alt+D).
  setFixedShortcuts({
    'CommandOrControl+Alt+D': () => {
      showNotch(true);
      emit('ui:openDebug', null);
    },
  });
  registerShortcuts({
    toggle: toggleNotch,
    quickCapture: () => {
      showNotch(true);
      emit('ui:navigate', { tab: 'add', expand: true, capture: true });
    },
    focusNext: () => {
      showNotch(false);
      emit('ui:navigate', { tab: 'home', expand: true });
    },
  });
  maybeDevCapture();
});

app.on('second-instance', () => showNotch(true));
app.on('will-quit', () => unregisterShortcuts());
app.on('window-all-closed', () => app.quit());
