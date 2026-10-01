import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', on: () => undefined, getName: () => 'Pipo' }, safeStorage: {}, systemPreferences: {}, shell: {}, protocol: {}, powerMonitor: {} }));
const { parseSpotifyTitle, isSpotifyWindow } = await import('../src/main/music/now-playing');

describe('parseSpotifyTitle', () => {
  it('lê "Artista - Faixa" enquanto toca', () => {
    expect(parseSpotifyTitle('Tim Maia - Azul da Cor do Mar')).toEqual({ artist: 'Tim Maia', track: 'Azul da Cor do Mar', playing: true, source: 'spotify-window' });
    // Só a primeira " - " separa: o resto é do nome da faixa.
    expect(parseSpotifyTitle('Daft Punk - Get Lucky - Radio Edit')?.track).toBe('Get Lucky - Radio Edit');
  });
  it('títulos de pausa e anúncios não contam como música', () => {
    for (const t of ['Spotify', 'Spotify Premium', 'Spotify Free', 'Advertisement', '', '   ', 'Sem separador']) expect(parseSpotifyTitle(t)).toBeNull();
  });
});

describe('isSpotifyWindow', () => {
  it('reconhece pelo nome ou pelo executável', () => {
    expect(isSpotifyWindow({ title: 'x', owner: { name: 'Spotify' } })).toBe(true);
    expect(isSpotifyWindow({ title: 'x', owner: { name: 'App', path: 'C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe' } })).toBe(true);
    expect(isSpotifyWindow({ title: 'Tim Maia - Azul', owner: { name: 'Google Chrome' } })).toBe(false);
  });
});

describe('Pipo dança com música', () => {
  it('dança acima do foco, mas abaixo de reunião, voz, agente e pausa', async () => {
    const { deriveMascotState } = await import('../src/shared/mascot-state');
    const base = { now: 0, transient: null, cardMascot: null, agentBusy: false, dragOver: false, listening: false, inMeeting: false, paused: false, music: true, focus: null, hovered: false, outsideWorkHours: false, idleLong: false, overGoalRatio: 0 };
    expect(deriveMascotState(base)).toBe('dancing');
    expect(deriveMascotState({ ...base, outsideWorkHours: true })).toBe('dancing');
    expect(deriveMascotState({ ...base, focus: { phase: 'focus', paused: false } as never })).toBe('dancing');
    expect(deriveMascotState({ ...base, inMeeting: true })).toBe('shh');
    expect(deriveMascotState({ ...base, listening: true })).toBe('listening');
    expect(deriveMascotState({ ...base, agentBusy: true })).toBe('thinking');
    expect(deriveMascotState({ ...base, paused: true })).toBe('sleepy');
    expect(deriveMascotState({ ...base, music: false })).toBe('idle');
  });
});

describe('foca na próxima', () => {
  it('reconhece o pedido curto e ignora o resto', async () => {
    const { isFocusNextIntent } = await import('../src/shared/intents');
    for (const ok of ['foca na próxima', 'Foca na proxima tarefa!', 'começar foco na próxima', 'bora focar na próxima', 'pipo, foca na próxima', 'iniciar o foco na próxima']) expect(isFocusNextIntent(ok)).toBe(true);
    for (const no of ['foca na próxima reunião', 'focar no relatório', 'próxima', 'qual a próxima tarefa?']) expect(isFocusNextIntent(no)).toBe(false);
  });
});
