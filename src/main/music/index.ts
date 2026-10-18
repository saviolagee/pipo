// Provedor de música com controle real (Spotify Web API): o Pipo lê o que está tocando e dança junto.
import type { NowPlaying } from '@shared/types';

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
