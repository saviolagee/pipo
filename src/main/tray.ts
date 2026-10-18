import { Menu, Tray, app, nativeImage } from 'electron';
import { APP_NAME } from '@shared/config';
import { emit } from './bus';
import { openDashboard } from './dashboard';
import { getSettings, patchSettings } from './db/repos/settings';
import { renderFace } from './icons';
import { miniHooks, setMini, showNotch } from './window';

let tray: Tray | null = null;

function trayImage(): Electron.NativeImage {
  const isMac = process.platform === 'darwin';
  // macOS: imagem "template" monocromática (o sistema inverte no modo escuro).
  const style = isMac ? 'mono' : 'mono-white';
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, buffer: renderFace({ size: isMac ? 18 : 16, style }) });
  img.addRepresentation({ scaleFactor: 2, buffer: renderFace({ size: isMac ? 36 : 32, style }) });
  if (isMac) img.setTemplateImage(true);
  return img;
}

export function setPaused(paused: boolean): void {
  patchSettings({ paused });
  emit('ui:paused', paused);
  rebuildMenu();
}

function rebuildMenu(): void {
  if (!tray) return;
  const { paused, mini, shortcuts } = getSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Anotar tarefa…',
      accelerator: shortcuts.quickCapture || undefined,
      click: () => {
        showNotch(true);
        emit('ui:navigate', { tab: 'add', expand: true, capture: true });
      },
    },
    { type: 'separator' },
    { label: 'Dashboards', accelerator: 'CommandOrControl+Shift+A', click: () => openDashboard() },
    {
      label: `Abrir ${APP_NAME}`,
      click: () => {
        showNotch(true);
        emit('ui:navigate', { tab: 'home', expand: true });
      },
    },
    {
      label: 'Configurações…',
      accelerator: 'CommandOrControl+,',
      click: () => {
        showNotch(true);
        emit('ui:navigate', { tab: 'settings', expand: true });
      },
    },
    { label: 'Modo miniatura', type: 'checkbox', checked: mini, accelerator: shortcuts.mini || undefined, click: () => setMini(!mini) },
    { label: paused ? 'Retomar' : 'Pausar', click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: 'Sair', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

export function createTray(): Tray {
  tray = new Tray(trayImage());
  tray.setToolTip(APP_NAME);
  rebuildMenu();
  miniHooks.changed = rebuildMenu;
  return tray;
}
