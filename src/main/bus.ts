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

// Janela do Pipo em tela cheia (quando aberta): recebe os mesmos dados do notch.
let full: BrowserWindow | null = null;

export function attachFullWindow(w: BrowserWindow | null): void {
  full = w;
}

export function getFullWindow(): BrowserWindow | null {
  return full && !full.isDestroyed() ? full : null;
}

/** Só o notch: ele roda os modelos locais, controla a própria janela e mostra os cards de atenção. */
const NOTCH_ONLY = new Set<MainEventName>(['embed:request', 'media:request', 'ui:toggle', 'ui:collapse', 'ui:navigate', 'ui:openDebug', 'ui:openPipoRun', 'clipboard:candidate', 'files:progress', 'chat:send', 'stripe:payment', 'sfx:play']);

function send<K extends MainEventName>(w: BrowserWindow | null, event: K, payload: MainEvents[K]): void {
  if (w && !w.webContents.isDestroyed()) w.webContents.send(event, payload);
}

/** Envia um evento tipado ao renderer (ao notch e, se aberta, à janela em tela cheia). */
export function emit<K extends MainEventName>(event: K, payload: MainEvents[K]): void {
  const f = getFullWindow();
  // Aviso curto vai só para onde a pessoa está olhando.
  if (event === 'toast:show' && f?.isFocused()) return send(f, event, payload);
  send(getWindow(), event, payload);
  if (f && !NOTCH_ONLY.has(event) && event !== 'toast:show') send(f, event, payload);
}

/** Eventos internos do main (entre módulos). */
export interface InternalEvents {
  'task:completed': { taskId: number };
  'task:changed': null;
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
