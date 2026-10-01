import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, session } from 'electron';
import { APP_ID, APP_NAME } from '@shared/config';
import { emit } from './bus';
import { registerBootstrapIpc } from './bootstrap';
import { quickCheckClaude } from './agent/detect-claude';
import { openDb } from './db';
import { paths } from './paths';
import { getSettings, patchSettings } from './db/repos/settings';
import { maybeDevCapture } from './dev-capture';
import { handle } from './ipc';
import { registerShortcuts, setFixedShortcuts, unregisterShortcuts } from './shortcuts';
import { registerCardsIpc } from './cards';
import { handleMediaProtocol, registerMediaScheme } from './music/fallback';
import { registerActivity } from './activity/ipc';
import { startScheduler } from './scheduler';
import { registerAgentIpc } from './agent/service';
import { registerDayFlows } from './agent/day-flows';
import { registerCapture } from './capture';
import { registerDebug } from './debug';
import { registerIntegrations } from './integrations/ipc';
import { registerInsights } from './insights';
import { registerContextReactions } from './insights/context-reactions';
import { startMcpBridge } from './mcp/server';
import { registerSystemIpc, setAutostart } from './system';
import { getProfile } from './db/repos/profile';
import { nextSuggested, registerTasksIpc } from './tasks/ipc';
import { startFocus } from './focus/session';
import { createTray, setPaused } from './tray';
import { createNotchWindow, setInteractive, showNotch, toggleNotch } from './window';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// App todo em pt-BR: força o locale do Chromium (inputs de hora em 24h, datas, etc.).
app.commandLine.appendSwitch('lang', 'pt-BR');
// Nenhuma rede além de Claude, Google e Spotify (seção 17): sem atualizações de componentes nem
// download de dicionários do Chromium.
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-features', 'SpellcheckService,MediaRouter,OptimizationHints,AutofillServerCommunication');
if (process.platform === 'linux') {
  // Janelas transparentes no Linux (útil para desenvolvimento).
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

registerMediaScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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
  ipcMain.on('ui:ready', () => undefined);
}

app.whenReady().then(() => {
  mkdirSync(paths.files, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  openDb(join(paths.userData, 'pipo.db'));
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:0/');

  if (process.platform === 'darwin') app.dock?.hide();

  registerCoreIpc();
  registerBootstrapIpc();
  registerSystemIpc();
  registerCardsIpc();
  registerTasksIpc();
  handleMediaProtocol();
  registerActivity();
  startMcpBridge();
  registerAgentIpc();
  registerDayFlows();
  registerCapture();
  registerContextReactions();
  registerDebug();
  registerIntegrations();
  registerInsights();
  startScheduler();
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
      const next = nextSuggested();
      void startFocus({ taskId: next?.id ?? null });
      emit('ui:navigate', { tab: 'home', expand: true });
    },
  });
  maybeDevCapture();
  void quickCheckClaude(paths.workspace);
  const profile = getProfile();
  if (profile) setAutostart(profile.autostart);
});

app.on('second-instance', () => showNotch(true));
app.on('will-quit', () => unregisterShortcuts());
app.on('window-all-closed', () => app.quit());
