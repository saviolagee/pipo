// Google OAuth (Agenda + Gmail) com loopback e PKCE (seção 9.11). Um consentimento só.
import { getIntegration, saveIntegration, type Tokens } from '../db/repos/integrations';
import { getKV, setKV } from '../db/repos/settings';
import { getSecret, setSecret } from '../secrets';
import { loopbackAuth, pkcePair, postForm } from './oauth';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  // Planilhas: passo `sheet` dos Pipos coloridos (V2). Quem conectou antes precisa reconectar.
  'https://www.googleapis.com/auth/spreadsheets',
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

/** Credenciais do app OAuth (tipo "App para computador" no Google Cloud). */
export function googleClient(): { clientId: string; clientSecret: string } | null {
  const clientId = getKV<string | null>('google:clientId', null) ?? import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? null;
  const clientSecret = getSecret('googleClientSecret') ?? import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? null;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function setGoogleClient(cfg: { clientId: string; clientSecret: string }): void {
  setKV('google:clientId', cfg.clientId.trim());
  setSecret('googleClientSecret', cfg.clientSecret.trim());
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function connectGoogle(): Promise<string | null> {
  const client = googleClient();
  if (!client) throw new Error('Configure o Client ID e o Client Secret do Google (veja docs/integracoes.md).');
  const { verifier, challenge } = pkcePair();
  const { code, redirectUri } = await loopbackAuth((redirect, state) => buildGoogleAuthUrl(client.clientId, redirect, state, challenge));
  const t = await postForm<TokenResponse>('https://oauth2.googleapis.com/token', {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const email = emailFromIdToken(t.id_token);
  saveIntegration('google', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, scope: t.scope }, { detail: email, email });
  return email;
}

export function disconnectGoogle(): void {
  const { tokens } = getIntegration('google');
  if (tokens?.access_token) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token ?? tokens.access_token)}`, { method: 'POST' }).catch(() => undefined);
  saveIntegration('google', null, {});
}

let refreshing: Promise<string> | null = null;

/** Access token válido (renova com o refresh token quando faltar menos de 1 min). */
export async function googleToken(): Promise<string> {
  const { tokens, meta } = getIntegration('google');
  if (!tokens) throw new Error('Google não conectado.');
  if (tokens.expires_at - Date.now() > 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Sessão do Google expirou. Conecte de novo.');
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const client = googleClient();
    if (!client) throw new Error('Credenciais do Google ausentes.');
    try {
      const t = await postForm<TokenResponse>('https://oauth2.googleapis.com/token', {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: tokens.refresh_token as string,
        grant_type: 'refresh_token',
      });
      const next: Tokens = { ...tokens, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
      saveIntegration('google', next, meta);
      return next.access_token;
    } catch (e) {
      saveIntegration('google', tokens, { ...meta, detail: 'Reconecte o Google' }, 'error');
      throw e;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

export async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await googleToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export function googleConnected(): boolean {
  return getIntegration('google').info.status === 'connected';
}
