import { DEFAULT_DISTRACTIONS, DEFAULT_IGNORED_APPS, DEFAULT_SHORTCUTS } from '@shared/config';
import { DEFAULT_AGENT } from '@shared/models';
import type { Settings } from '@shared/types';
import { db } from '../index';

export const DEFAULT_SETTINGS: Settings = {
  agent: { ...DEFAULT_AGENT },
  volume: 0.6,
  muted: false,
  paused: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  distractions: { items: [...DEFAULT_DISTRACTIONS], toleranceSec: 60, allowed: [] },
  privacy: { trackingPaused: false, ignoredApps: [...DEFAULT_IGNORED_APPS] },
  reactions: { meeting: true, email: true, clipboard: true, unstuck: true, music: true },
};

export function getKV<T>(key: string, fallback: T): T {
  const row = db().get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setKV<T>(key: string, value: T): void {
  db().run(
    'INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
    key,
    JSON.stringify(value),
  );
}

export function getSettings(): Settings {
  const s = getKV<Partial<Settings>>('app', {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...s.shortcuts },
    distractions: { ...DEFAULT_SETTINGS.distractions, ...s.distractions },
    privacy: { ...DEFAULT_SETTINGS.privacy, ...s.privacy },
    reactions: { ...DEFAULT_SETTINGS.reactions, ...s.reactions },
    agent: { ...DEFAULT_SETTINGS.agent, ...s.agent },
  };
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  setKV('app', next);
  return next;
}
