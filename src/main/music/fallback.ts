// Música sem API: abre o link (Spotify/YouTube) no app/navegador ou toca um arquivo local no renderer.
import { existsSync } from 'node:fs';
import { protocol, shell } from 'electron';
import type { MusicConfig } from '@shared/types';
import { emit } from '../bus';

/** https://open.spotify.com/playlist/ID?si=… → spotify:playlist:ID */
export function spotifyUri(link: string): string | null {
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/.exec(link);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  if (/^spotify:[a-z]+:[A-Za-z0-9]+$/.test(link)) return link;
  return null;
}

export async function openLink(link: string): Promise<void> {
  const uri = spotifyUri(link);
  if (uri) {
    try {
      // Abre direto no app desktop do Spotify; se não houver app, cai no navegador.
      await shell.openExternal(uri);
      return;
    } catch {
      // segue para o link web
    }
  }
  if (/^https?:\/\//i.test(link)) await shell.openExternal(link);
}

let allowedFile: string | null = null;

/** Protocolo `pipo-media://` que serve apenas o arquivo de música configurado. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'pipo-media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }]);
}

export function handleMediaProtocol(): void {
  protocol.handle('pipo-media', async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    if (!allowedFile || path !== allowedFile || !existsSync(path)) return new Response('not found', { status: 404 });
    const { net } = await import('electron');
    const { pathToFileURL } = await import('node:url');
    return net.fetch(pathToFileURL(path).toString(), { headers: req.headers });
  });
}

export function playLocal(cfg: MusicConfig): void {
  if (!cfg.filePath) return;
  allowedFile = cfg.filePath;
  emit('music:local', { action: 'play', filePath: cfg.filePath });
}

export function pauseLocal(): void {
  emit('music:local', { action: 'pause' });
}

export function stopLocal(): void {
  emit('music:local', { action: 'stop' });
}
