import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, powerMonitor, safeStorage, session } from 'electron';
import { APP_ID, APP_NAME } from '@shared/config';
import { emit } from './bus';
import { registerBootstrapIpc } from './bootstrap';
import { handleFileProtocol, registerFileScheme } from './files/protocol';
import { quickCheckClaude } from './agent/detect-claude';
import { openDb } from './db';
import { paths } from './paths';
import { getSettings, patchSettings } from './db/repos/settings';
import { maybeDevCapture } from './dev-capture';
import { handle } from './ipc';
import { registerShortcuts, setFixedShortcuts, unregisterShortcuts } from './shortcuts';
import { registerCardsIpc } from './cards';
import { registerActivity } from './activity/ipc';
import { startScheduler } from './scheduler';
import { registerAgentIpc } from './agent/service';
import { registerDayFlows } from './agent/day-flows';
import { registerCapture } from './capture';
import { registerDebug } from './debug';
import { registerIntegrations } from './integrations/ipc';
import { registerInsights } from './insights';
import { registerDays } from './days/flows';
import { registerGoals } from './goals';
import { registerBrowser } from './browser';
import { registerDecide } from './decide';
import { registerPiposIpc } from './pipos/ipc';
import { registerBuilder } from './pipos/builder';
import { registerTriggers } from './pipos/triggers';
import { registerPipoChat } from './pipos/pipo-chat';
import { registerLinks } from './pipos/links';
import { registerEvents } from './pipos/events';
import { openDashboard, registerDashboard } from './dashboard';
import { registerContextReactions } from './insights/context-reactions';
import { startMcpBridge } from './mcp/server';
import { registerSystemIpc, setAutostart } from './system';
import { getProfile } from './db/repos/profile';
import { registerTasksIpc } from './tasks/ipc';
import { createTray, setPaused } from './tray';
import { createNotchWindow, setInteractive, setMini, showNotch, toggleMini, toggleNotch } from './window';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// App todo em pt-BR: força o locale do Chromium (inputs de hora em 24h, datas, etc.).
app.commandLine.appendSwitch('lang', 'pt-BR');
// O app em si só fala com Claude, Google e Spotify (seção 17); o navegador dos Pipos abre os sites
// que o usuário pede, em sessões separadas. Sem atualizações de componentes nem
// download de dicionários do Chromium.
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-features', 'SpellcheckService,MediaRouter,OptimizationHints,AutofillServerCommunication');
if (process.platform === 'linux') {
  // Janelas transparentes no Linux (útil para desenvolvimento).
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
// Anexos (vídeo, imagem) abertos pela janela do Pipo: precisa ser registrado antes do app ficar pronto.
registerFileScheme();

// Teste de fumaça/E2E: perfil isolado, sem tocar nos dados do usuário.
if (process.env.PIPO_USER_DATA && (!app.isPackaged || process.env.PIPO_E2E === '1')) app.setPath('userData', process.env.PIPO_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function registerCoreIpc(): void {
  handle('window:setInteractive', (on) => setInteractive(on));
  // Aberto por voz: só pega o teclado com o usuário parado há 1 s (um falso chamado não rouba a digitação).
  handle('window:show', ({ focusIfIdle }) => showNotch(!focusIfIdle || powerMonitor.getSystemIdleTime() >= 1));
  handle('window:setExpanded', () => undefined);
  handle('window:setMini', (on) => setMini(on));
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
  // Só em desenvolvimento, num Linux sem chaveiro (contêiner de testes): cofre com chave em memória.
  // Nunca no app empacotado; os segredos não sobrevivem a reiniciar.
  if (!app.isPackaged && process.platform === 'linux' && process.env.PIPO_DEV_MEMORY_VAULT === '1') safeStorage.setUsePlainTextEncryption(true);
  mkdirSync(paths.files, { recursive: true });
  handleFileProtocol();
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
  registerActivity();
  startMcpBridge();
  registerAgentIpc();
  registerDayFlows();
  registerCapture();
  registerContextReactions();
  registerDebug();
  registerIntegrations();
  registerInsights();
  registerDays();
  registerGoals();
  registerPiposIpc();
  registerBuilder();
  registerBrowser();
  registerDecide();
  registerTriggers();
  registerPipoChat();
  registerLinks();
  registerEvents();
  registerDashboard();
  startScheduler();
  createNotchWindow();
  createTray();
  // Painel de debug do mascote (Ctrl+Alt+D).
  setFixedShortcuts({
    // Dashboards (Fase 22).
    'CommandOrControl+Shift+A': () => openDashboard(),
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
    mini: toggleMini,
  });
  maybeDevCapture();
  void quickCheckClaude(paths.workspace);
  const profile = getProfile();
  if (profile) setAutostart(profile.autostart);
});

app.on('second-instance', () => showNotch(true));
app.on('will-quit', () => unregisterShortcuts());
app.on('window-all-closed', () => app.quit());
