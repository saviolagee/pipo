// Navegador dos Pipos: registra as ferramentas do chat e do construtor e a janela de login de cada Pipo.
import { app, session } from 'electron';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { pipoHooks } from '../pipos/ipc';
import { activePlaybook, getPipo } from '../pipos/repo';
import { builderWebTools } from './builder-tools';
import { closeAllWebSessions, isHttpUrl, openVisible, pipoPartition, webSession } from './session';
import { webTools } from './tools';

/** Primeiro site do plano do Pipo: o de um passo browser ou o de uma chamada capturada de um site. */
function firstSite(pipoId: number): string | null {
  for (const s of activePlaybook(pipoId)?.playbook.steps ?? []) {
    const url = s.kind === 'browser' ? s.url : s.kind === 'http' ? s.capturedFrom : null;
    if (url && isHttpUrl(url) && !url.includes('{{')) return url;
  }
  return null;
}

export function registerBrowser(): void {
  registerTools(webTools);
  registerTools(builderWebTools);

  handle('pipos:openBrowser', (id) => {
    const p = getPipo(id);
    if (!p) return false;
    openVisible(pipoPartition(p.slug), firstSite(id) ?? 'https://duckduckgo.com/', `${p.name} — navegador`);
    return true;
  });

  pipoHooks.deleted = (slug) => {
    webSession(pipoPartition(slug)).close();
    void session.fromPartition(pipoPartition(slug)).clearStorageData();
  };
  app.on('will-quit', () => closeAllWebSessions());
}
