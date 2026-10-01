// Integrações com o sistema operacional: links, terminal, preferências, diálogos, autostart, dados.
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog, shell, systemPreferences } from 'electron';
import { db } from './db';
import { getWindow } from './bus';
import { handle } from './ipc';

export function openTerminal(): void {
  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } else {
    spawn('x-terminal-emulator', [], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
  }
}

export function setAutostart(on: boolean): void {
  if (!app.isPackaged) return; // Em desenvolvimento não registra o binário do Electron.
  app.setLoginItemSettings({ openAtLogin: on });
}

export function macPermissions(): { accessibility: boolean; screen: boolean } {
  if (process.platform !== 'darwin') return { accessibility: true, screen: true };
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen: systemPreferences.getMediaAccessStatus('screen') === 'granted',
  };
}

const TABLES = [
  'profile',
  'rituals',
  'clients',
  'tasks',
  'subtasks',
  'focus_sessions',
  'activity_blocks',
  'interruptions',
  'mood_snapshots',
  'streaks',
  'conversations',
  'messages',
  'attachments',
  'tool_permissions',
  'settings',
];

export function registerSystemIpc(): void {
  handle('app:openExternal', (url) => {
    if (/^(https?|spotify|mailto):/i.test(url)) void shell.openExternal(url);
  });
  handle('app:openTerminal', () => openTerminal());
  handle('app:openSystemPrefs', (pane) => {
    if (process.platform !== 'darwin') return;
    const target = pane === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
    if (pane === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${target}`);
  });
  handle('app:macPermissions', () => macPermissions());
  handle('app:pickFile', async (kind) => {
    const w = getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: kind === 'audio' ? [{ name: 'Áudio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] }] : [],
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('app:exportData', async () => {
    const w = getWindow();
    const opts: Electron.SaveDialogOptions = { defaultPath: `pipo-dados-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    const dump: Record<string, unknown[]> = {};
    for (const t of TABLES) dump[t] = db().all(`SELECT * FROM ${t}`);
    // Tokens criptografados não são exportados.
    dump.integrations = db().all('SELECT provider, status, meta_json, connected_at FROM integrations');
    writeFileSync(r.filePath, JSON.stringify(dump, null, 2));
    return r.filePath;
  });
  handle('app:wipeData', () => {
    db().close();
    const dir = app.getPath('userData');
    for (const f of ['pipo.db', 'pipo.db-wal', 'pipo.db-shm']) rmSync(join(dir, f), { force: true });
    rmSync(join(dir, 'files'), { recursive: true, force: true });
    app.relaunch();
    app.exit(0);
  });
}
