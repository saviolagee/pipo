// Sabe se tem música tocando agora, para o Pipo dançar. Três fontes, da mais precisa para a mais simples:
// 1. Spotify Web API (se conectado): faixa e estado reais, em qualquer dispositivo.
// 2. Título da janela do app desktop do Spotify (Windows/Linux mostram "Artista - Faixa" enquanto toca
//    e "Spotify Premium" em pausa). Funciona sem conectar nada. Lido localmente, nunca gravado.
// 3. O arquivo local do ritual de foco.
import { app } from 'electron';
import type { NowPlaying } from '@shared/types';
import { emit } from '../bus';
import { getSettings } from '../db/repos/settings';
import { macPermissions } from '../system';
import { isIgnored } from '../activity/classifier';
import { musicApi } from './index';
import { localPlaying } from './fallback';

const TICK_MS = 5_000;
/** A API do Spotify é consultada a cada 3 ciclos (15s) para não gastar rede à toa. */
const API_EVERY = 3;

interface WindowInfo {
  title: string;
  owner: { name: string; path?: string };
}
type OpenWindowsFn = (opts?: { accessibilityPermission?: boolean; screenRecordingPermission?: boolean }) => Promise<WindowInfo[]>;

const IDLE_TITLES = /^(spotify( premium| free)?|advertisement|anúncio)$/i;

/** "Artista - Faixa" → faixa/artista. Títulos de pausa ("Spotify Premium") e anúncios → null. */
export function parseSpotifyTitle(title: string): NowPlaying | null {
  const t = title.trim();
  if (!t || IDLE_TITLES.test(t)) return null;
  const i = t.indexOf(' - ');
  if (i <= 0) return null;
  const artist = t.slice(0, i).trim();
  const track = t.slice(i + 3).trim();
  if (!artist || !track) return null;
  return { artist, track, playing: true, source: 'spotify-window' };
}

export function isSpotifyWindow(w: WindowInfo): boolean {
  return /spotify/i.test(w.owner.name) || /spotify(\.exe|\.app)/i.test(w.owner.path ?? '');
}

let openWindows: OpenWindowsFn | null = null;
let loadFailed = false;

async function fromWindows(): Promise<NowPlaying | null> {
  if (!openWindows && !loadFailed) {
    try {
      openWindows = ((await import('get-windows')) as { openWindows: OpenWindowsFn }).openWindows;
    } catch {
      loadFailed = true;
    }
  }
  if (!openWindows) return null;
  const perms = macPermissions();
  // No macOS, sem gravação de tela não há títulos: nada a fazer (e nada é pedido).
  if (process.platform === 'darwin' && !perms.screen) return null;
  try {
    const wins = await openWindows({ accessibilityPermission: perms.accessibility, screenRecordingPermission: perms.screen });
    for (const w of wins) {
      if (!isSpotifyWindow(w)) continue;
      const np = parseSpotifyTitle(w.title ?? '');
      if (np) return np;
    }
  } catch {
    // ignora: a próxima leitura tenta de novo
  }
  return null;
}

let current: NowPlaying | null = null;
let apiCache: NowPlaying | null = null;
let tick = 0;
let timer: NodeJS.Timeout | null = null;

const keyOf = (n: NowPlaying | null): string => (n ? `${n.source}|${n.artist}|${n.track}|${n.playing}` : '');

function publish(next: NowPlaying | null): void {
  if (keyOf(next) === keyOf(current)) return;
  current = next;
  emit('music:nowPlaying', next);
}

/** Uma leitura. `forceApi` refaz a consulta à API (ex.: logo depois de play/pause pelo Pipo). */
export async function refreshNowPlaying(forceApi = false): Promise<NowPlaying | null> {
  const s = getSettings();
  const local = localPlaying();
  if (local) {
    publish({ track: local, artist: '', playing: true, source: 'local' });
    return current;
  }
  const spotify = musicApi();
  if (spotify?.isConnected()) {
    if (forceApi || tick % API_EVERY === 0) {
      const r = await spotify.nowPlaying().catch(() => undefined);
      // Falha de rede/token: mantém a última leitura em vez de "parar de dançar" por um soluço.
      if (r !== undefined) apiCache = r ? { ...r, source: 'spotify-api' } : null;
    }
    if (apiCache) {
      publish(apiCache);
      return current;
    }
  }
  // Título de janela só serve para dançar, e respeita a privacidade: registro pausado ou Spotify na
  // lista de ignorados.
  const windowAllowed = s.reactions.music && !s.privacy.trackingPaused && !isIgnored(s.privacy.ignoredApps, 'Spotify');
  publish(windowAllowed ? await fromWindows() : null);
  return current;
}

export function nowPlaying(): NowPlaying | null {
  return current;
}

export function startNowPlaying(): void {
  if (timer) return;
  const run = (): void => {
    // Pipo pausado: não lê nada.
    if (getSettings().paused) {
      tick = 0;
      apiCache = null;
      publish(null);
      return;
    }
    void refreshNowPlaying().finally(() => tick++);
  };
  timer = setInterval(run, TICK_MS);
  app.on('will-quit', () => timer && clearInterval(timer));
  run();
}
