// Controle de música do ritual de foco (seção 9.4).
import type { MusicConfig, NowPlaying } from '@shared/types';
import { musicRitual } from '../db/repos/rituals';
import { openLink, pauseLocal, playLocal, stopLocal } from './fallback';

/** Provedor com controle real (Spotify Web API), registrado na Fase 10. */
export interface MusicApi {
  isConnected(): boolean;
  play(link: string | null): Promise<boolean>;
  pause(): Promise<void>;
  resume(): Promise<boolean>;
  toggle(): Promise<NowPlaying | null>;
  nowPlaying(): Promise<NowPlaying | null>;
}

let api: MusicApi | null = null;
export function setMusicApi(a: MusicApi): void {
  api = a;
}
export function musicApi(): MusicApi | null {
  return api;
}

type Mode = 'spotify-api' | 'link' | 'file' | null;
let mode: Mode = null;
let openedThisSession = false;

export function musicConfig(): MusicConfig | null {
  return musicRitual()?.config ?? null;
}

/** Nome curto para "🎧 Tocando: …". */
export function musicLabel(cfg: MusicConfig): string {
  if (cfg.source === 'file' && cfg.filePath) return cfg.filePath.split(/[\\/]/).pop() ?? 'arquivo local';
  if (cfg.link?.includes('spotify')) return 'sua playlist no Spotify';
  if (cfg.link?.includes('youtu')) return 'sua playlist no YouTube';
  return 'sua playlist';
}

/** Começa a tocar no início do foco. Retorna true se há música ativa. */
export async function startMusic(): Promise<boolean> {
  const cfg = musicConfig();
  if (!cfg || !cfg.autoplay) return false;
  openedThisSession = false;
  if (cfg.source === 'file' && cfg.filePath) {
    mode = 'file';
    playLocal(cfg);
    return true;
  }
  if (api?.isConnected() && (cfg.source === 'spotify' || cfg.link?.includes('spotify'))) {
    try {
      if (await api.play(cfg.link)) {
        mode = 'spotify-api';
        return true;
      }
    } catch (e) {
      console.warn('[música] Spotify API falhou, usando o link:', e);
    }
  }
  if (cfg.link) {
    mode = 'link';
    await openLink(cfg.link);
    openedThisSession = true;
    return true;
  }
  return false;
}

/** Na pausa do pomodoro (se configurado). Links abertos fora não têm como pausar. */
export async function pauseMusic(): Promise<void> {
  const cfg = musicConfig();
  if (!cfg?.pauseOnBreak) return;
  if (mode === 'file') pauseLocal();
  if (mode === 'spotify-api') await api?.pause().catch(() => undefined);
}

export async function resumeMusic(): Promise<void> {
  const cfg = musicConfig();
  if (!cfg) return;
  if (mode === 'file') playLocal(cfg);
  if (mode === 'spotify-api') await api?.resume().catch(() => undefined);
  if (mode === 'link' && !openedThisSession && cfg.link) await openLink(cfg.link);
}

export async function stopMusic(): Promise<void> {
  if (mode === 'file') stopLocal();
  if (mode === 'spotify-api') await api?.pause().catch(() => undefined);
  mode = null;
}

export function musicMode(): Mode {
  return mode;
}
