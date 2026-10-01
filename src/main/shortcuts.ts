import { globalShortcut } from 'electron';
import type { ShortcutId } from '@shared/config';
import { getSettings } from './db/repos/settings';

export type ShortcutActions = Record<ShortcutId, () => void>;

let actions: ShortcutActions | null = null;
/** Atalhos fixos (não configuráveis), como o painel de debug. */
let fixed: Record<string, () => void> = {};

export function setFixedShortcuts(map: Record<string, () => void>): void {
  fixed = map;
}

/** (Re)registra os atalhos globais a partir das configurações. Retorna os que falharam. */
export function registerShortcuts(next?: ShortcutActions): ShortcutId[] {
  if (next) actions = next;
  if (!actions) return [];
  globalShortcut.unregisterAll();
  const failed: ShortcutId[] = [];
  const map = getSettings().shortcuts;
  for (const id of Object.keys(map) as ShortcutId[]) {
    const accel = map[id];
    const fn = actions[id];
    try {
      if (!accel || !globalShortcut.register(accel, fn)) failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  for (const [accel, fn] of Object.entries(fixed)) {
    try {
      globalShortcut.register(accel, fn);
    } catch {
      // ignora
    }
  }
  if (failed.length) console.warn('[atalhos] não registrados:', failed.join(', '));
  return failed;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
