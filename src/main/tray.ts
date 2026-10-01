import { Menu, Tray, app, nativeImage } from 'electron';
import { APP_NAME } from '@shared/config';
import { bus, emit } from './bus';
import { focusState, startFocus } from './focus/session';
import { nextSuggested } from './tasks/ipc';
import { getSettings, patchSettings } from './db/repos/settings';
import { renderFace } from './icons';
import { showNotch } from './window';

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
  const paused = getSettings().paused;
  const focus = focusState();
  const next = focus ? null : nextSuggested();
  const short = (s: string): string => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
  const menu = Menu.buildFromTemplate([
    focus
      ? { label: `Focando: ${short(focus.taskTitle)}`, enabled: false }
      : {
          label: next ? `▶ Focar na próxima: ${short(next.title)}` : '▶ Começar foco',
          click: () => {
            showNotch(true);
            emit('ui:navigate', { tab: next ? 'home' : 'add', expand: true, capture: !next });
            if (next) void startFocus({ taskId: next.id });
          },
        },
    { type: 'separator' },
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
  // O item "Focar na próxima" acompanha as tarefas e o foco.
  bus.on('task:changed', rebuildMenu);
  bus.on('focus:completed', rebuildMenu);
  setInterval(rebuildMenu, 30_000).unref();
  return tray;
}
