import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, shell: { openExternal: async () => undefined }, safeStorage: {}, protocol: {}, ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined } }));
const { mapEvents, meetingUrlOf } = await import('../src/main/integrations/calendar');
const { buildGoogleAuthUrl, GOOGLE_SCOPES } = await import('../src/main/integrations/google-auth');
const { buildSpotifyAuthUrl, SPOTIFY_PORT } = await import('../src/main/music/spotify');
const { loopbackAuth, pkcePair } = await import('../src/main/integrations/oauth');
const { spotifyUri } = await import('../src/main/music/fallback');

describe('Google Agenda', () => {
  it('acha o link de Meet/Zoom/Teams', () => {
    expect(meetingUrlOf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
    expect(meetingUrlOf({ description: 'Entrar: https://us02web.zoom.us/j/123456789?pwd=xyz obrigado' })).toBe('https://us02web.zoom.us/j/123456789?pwd=xyz');
    expect(meetingUrlOf({ location: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc' })).toContain('teams.microsoft.com');
    expect(meetingUrlOf({ location: 'Sala 3' })).toBeNull();
  });

  it('ignora eventos de dia inteiro, cancelados, recusados e "disponível"', () => {
    const ev = (p: Record<string, unknown>) => ({ id: 'x', summary: 's', start: { dateTime: '2026-10-01T14:00:00-03:00' }, end: { dateTime: '2026-10-01T15:00:00-03:00' }, ...p });
    const r = mapEvents([
      ev({ id: 'ok' }),
      ev({ id: 'allday', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }),
      ev({ id: 'cancel', status: 'cancelled' }),
      ev({ id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }] }),
      ev({ id: 'free', transparency: 'transparent' }),
    ] as never);
    expect(r.map((e) => e.id)).toEqual(['ok']);
    expect(r[0].start).toBe('2026-10-01T17:00:00.000Z');
  });
});

describe('OAuth', () => {
  it('URL do Google com PKCE, offline e escopos de agenda + gmail readonly', () => {
    const u = new URL(buildGoogleAuthUrl('cid', 'http://127.0.0.1:5555/callback', 'st', 'ch'));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
  });

  it('URL do Spotify com PKCE e porta fixa', () => {
    const u = new URL(buildSpotifyAuthUrl('sid', `http://127.0.0.1:${SPOTIFY_PORT}/callback`, 'st', 'ch'));
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43821/callback');
    expect(u.searchParams.get('scope')).toContain('user-modify-playback-state');
  });

  it('PKCE: challenge = base64url(sha256(verifier))', async () => {
    const { createHash } = await import('node:crypto');
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('loopback recebe o código no /callback e confere o state', async () => {
    const r = await loopbackAuth(
      (redirect, state) => `${redirect}?code=CODE123&state=${state}`,
      { open: async (url) => void (await fetch(url)), timeoutMs: 5000 },
    );
    expect(r.code).toBe('CODE123');
    expect(r.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it('loopback rejeita state inválido', async () => {
    await expect(loopbackAuth((redirect) => `${redirect}?code=X&state=errado`, { open: async (url) => void (await fetch(url)), timeoutMs: 5000 })).rejects.toThrow(/estado inválido/);
  });
});

describe('Spotify', () => {
  it('converte links em URIs', () => {
    expect(spotifyUri('https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=abc')).toBe('spotify:playlist:37i9dQZF1DWZeKCadgRdKQ');
    expect(spotifyUri('https://open.spotify.com/intl-pt/album/1ATL5GLyefJaxhQzSPVrLX')).toBe('spotify:album:1ATL5GLyefJaxhQzSPVrLX');
    expect(spotifyUri('https://youtube.com/x')).toBeNull();
  });
});
