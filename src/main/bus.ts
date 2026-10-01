import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import type { MainEventName, MainEvents } from '@shared/ipc-contract';

let win: BrowserWindow | null = null;

export function attachWindow(w: BrowserWindow): void {
  win = w;
}

export function getWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/** Envia um evento tipado ao renderer. */
export function emit<K extends MainEventName>(event: K, payload: MainEvents[K]): void {
  const w = getWindow();
  if (w && !w.webContents.isDestroyed()) w.webContents.send(event, payload);
}

/** Eventos internos do main (entre módulos). */
export interface InternalEvents {
  'task:completed': { taskId: number };
  'task:changed': null;
  'focus:completed': { sessionId: number; taskId: number | null };
  'focus:changed': null;
  'activity:block': { category: string };
  'meeting:started': null;
  'meeting:ended': null;
  'day:goalCheck': null;
}

class TypedBus {
  private ee = new EventEmitter();
  on<K extends keyof InternalEvents>(k: K, fn: (p: InternalEvents[K]) => void): void {
    this.ee.on(k, fn);
  }
  emit<K extends keyof InternalEvents>(k: K, p: InternalEvents[K]): void {
    this.ee.emit(k, p);
  }
}

export const bus = new TypedBus();
