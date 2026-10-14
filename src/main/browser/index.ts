// Navegador dos Pipos: registra as ferramentas do chat e do construtor e a janela de login de cada Pipo.
import { app, session } from 'electron';
import { emit } from '../bus';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { pipesChanged, pipoHooks } from '../pipos/ipc';
import { activePlaybook, getPipo } from '../pipos/repo';
import { builderWebTools } from './builder-tools';
import { renewSession, usesCapturedSite } from './capture';
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
    const playbook = activePlaybook(id)?.playbook ?? null;
    const url = firstSite(id) ?? 'https://duckduckgo.com/';
    const title = `${p.name} — navegador`;
    if (!playbook || !usesCapturedSite(playbook)) {
      openVisible(pipoPartition(p.slug), url, title);
      return true;
    }
    // Plano com chamadas capturadas: entrar no site de novo e fechar a janela renova a sessão.
    void renewSession(p.slug, playbook, url, title)
      .then((names) => {
        if (names.length) emit('toast:show', { id: `renew:${p.id}:${Date.now()}`, text: `${p.name}: sessão do site renovada.`, durationMs: 5000 });
        pipesChanged();
      })
      .catch((e) => emit('toast:show', { id: `renew:${p.id}:${Date.now()}`, text: `Não consegui renovar a sessão: ${(e as Error).message}`, durationMs: 6000 }));
    return true;
  });

  pipoHooks.deleted = (slug) => {
    webSession(pipoPartition(slug)).close();
    void session.fromPartition(pipoPartition(slug)).clearStorageData();
  };
  app.on('will-quit', () => closeAllWebSessions());
}
