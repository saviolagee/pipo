// Spotify Web API com OAuth PKCE (seção 9.4). Exige Premium e um dispositivo ativo; se falhar, o
// controlador de música cai no link (app desktop).
import type { NowPlaying } from '@shared/types';
import { getIntegration, saveIntegration } from '../db/repos/integrations';
import { getKV, setKV } from '../db/repos/settings';
import { loopbackAuth, pkcePair, postForm } from '../integrations/oauth';
import { spotifyUri } from './fallback';
import type { MusicApi } from './index';

/** Porta fixa: o Spotify exige o redirect exato registrado no app (http://127.0.0.1:43821/callback). */
export const SPOTIFY_PORT = 43821;
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state', 'user-read-currently-playing'];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export function spotifyClientId(): string | null {
  return getKV<string | null>('spotify:clientId', null) ?? import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID ?? null;
}

export function setSpotifyClientId(id: string): void {
  setKV('spotify:clientId', id.trim());
}

export function buildSpotifyAuthUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const u = new URL('https://accounts.spotify.com/authorize');
  u.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
    state,
  }).toString();
  return u.toString();
}

export async function connectSpotify(): Promise<string | null> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('Configure o Client ID do Spotify em Configurações → Integrações (veja docs/integracoes.md).');
  const { verifier, challenge } = pkcePair();
  const { code, redirectUri } = await loopbackAuth((redirect, state) => buildSpotifyAuthUrl(clientId, redirect, state, challenge), { port: SPOTIFY_PORT });
  const t = await postForm<TokenResponse>('https://accounts.spotify.com/api/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
  saveIntegration('spotify', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, scope: t.scope }, {});
  const me = await spotifyFetch<{ display_name?: string; product?: string }>('GET', '/me').catch(() => null);
  const detail = me ? `${me.display_name ?? 'Spotify'}${me.product && me.product !== 'premium' ? ' (sem Premium: abro o link)' : ''}` : 'Spotify';
  saveIntegration('spotify', getIntegration('spotify').tokens, { detail, product: me?.product ?? null });
  return detail;
}

export function disconnectSpotify(): void {
  saveIntegration('spotify', null, {});
}

async function token(): Promise<string> {
  const { tokens, meta } = getIntegration('spotify');
  if (!tokens) throw new Error('Spotify não conectado.');
  if (tokens.expires_at - Date.now() > 60_000) return tokens.access_token;
  const clientId = spotifyClientId();
  if (!tokens.refresh_token || !clientId) throw new Error('Sessão do Spotify expirou.');
  const t = await postForm<TokenResponse>('https://accounts.spotify.com/api/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
  saveIntegration('spotify', { ...tokens, access_token: t.access_token, refresh_token: t.refresh_token ?? tokens.refresh_token, expires_at: Date.now() + t.expires_in * 1000 }, meta);
  return t.access_token;
}

class SpotifyError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`Spotify ${status}: ${reason}`);
  }
}

async function spotifyFetch<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    let reason = text.slice(0, 160);
    try {
      reason = (JSON.parse(text) as { error?: { reason?: string; message?: string } }).error?.reason ?? reason;
    } catch {
      // mantém o texto
    }
    throw new SpotifyError(res.status, reason);
  }
  return text ? (JSON.parse(text) as T) : null;
}

async function playOn(contextUri: string | null): Promise<void> {
  const body = contextUri ? { context_uri: contextUri } : undefined;
  try {
    await spotifyFetch('PUT', '/me/player/play', body);
  } catch (e) {
    if (!(e instanceof SpotifyError) || e.status !== 404) throw e;
    // NO_ACTIVE_DEVICE: tenta o primeiro dispositivo disponível.
    const devs = await spotifyFetch<{ devices: Array<{ id: string; is_restricted: boolean }> }>('GET', '/me/player/devices');
    const dev = devs?.devices.find((d) => !d.is_restricted);
    if (!dev) throw e;
    await spotifyFetch('PUT', `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, body);
  }
}

export const spotifyApi: MusicApi = {
  isConnected: () => getIntegration('spotify').info.status === 'connected',
  async play(link) {
    const uri = link ? spotifyUri(link) : null;
    await playOn(uri && !uri.startsWith('spotify:track:') ? uri : null);
    return true;
  },
  async pause() {
    await spotifyFetch('PUT', '/me/player/pause').catch(() => undefined);
  },
  async resume() {
    await playOn(null);
    return true;
  },
  async toggle() {
    const now = await this.nowPlaying();
    if (now?.playing) await this.pause();
    else await this.resume();
    return this.nowPlaying();
  },
  async nowPlaying(): Promise<NowPlaying | null> {
    const r = await spotifyFetch<{ is_playing: boolean; item?: { name: string; artists?: Array<{ name: string }> } }>('GET', '/me/player/currently-playing').catch(() => null);
    if (!r?.item) return null;
    return { track: r.item.name, artist: (r.item.artists ?? []).map((a) => a.name).join(', '), playing: r.is_playing };
  },
};
