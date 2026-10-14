// Navegador dos Pipos: uma janela do Chromium embutido, fora da tela, controlada pelo app.
// Cada dono (o Pipo branco ou um Pipo colorido) tem a sua sessão, com cookies e logins próprios.
import { writeFileSync } from 'node:fs';
import { BrowserWindow, session as electronSession, type Session, type WebContents } from 'electron';
import { pageCall } from './page-script';

export class WebError extends Error {}

export interface PageElement {
  ref: number;
  role: string;
  name: string;
  value?: string;
  href?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  /** Elementos clicáveis que não couberam na lista. */
  more: number;
}

export interface ElementInfo {
  role: string;
  name: string;
  /** Link comum (clicar só navega). */
  href: string | null;
  password: boolean;
  field: boolean;
}

interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  value?: T;
}

const LOAD_TIMEOUT_MS = 30_000;
const IDLE_CLOSE_MS = 10 * 60_000;
const prepared = new Set<string>();

export const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/** Sessão isolada do resto do app: sem downloads, sem permissões (câmera, local, avisos). */
export function webPartition(partition: string): Session {
  const s = electronSession.fromPartition(partition);
  if (!prepared.has(partition)) {
    prepared.add(partition);
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on('will-download', (e) => e.preventDefault());
  }
  return s;
}

/** Só http(s), sem janelas novas (o link abre na mesma), sem identificar o app no navegador. */
export function hardenContents(wc: WebContents): void {
  wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|pipo|Pipo)\/\S+/g, ''));
  wc.on('will-navigate', (e, url) => {
    if (!isHttpUrl(url)) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void wc.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
  wc.on('will-prevent-unload', (e) => e.preventDefault());
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class WebSession {
  private win: BrowserWindow | null = null;
  private idle: NodeJS.Timeout | null = null;

  constructor(readonly partition: string) {}

  private contents(): WebContents {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: { session: webPartition(this.partition), offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
      });
      this.win.webContents.setAudioMuted(true);
      hardenContents(this.win.webContents);
    }
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    return this.win.webContents;
  }

  get webContents(): WebContents {
    return this.contents();
  }

  url(): string {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.getURL() : '';
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    try {
      return (await this.contents().executeJavaScript(pageCall(method, ...args), true)) as T;
    } catch (e) {
      throw new WebError(`A página não respondeu (${(e as Error).message.slice(0, 120)}).`);
    }
  }

  private async act(method: string, ...args: unknown[]): Promise<void> {
    const r = await this.call<Result>(method, ...args);
    if (!r?.ok) throw new WebError(r?.error ?? 'A ação não funcionou.');
  }

  /** Espera a página parar de carregar (navegação depois de um clique, por exemplo). */
  async settle(signal?: AbortSignal): Promise<void> {
    const wc = this.contents();
    await sleep(350);
    const until = Date.now() + LOAD_TIMEOUT_MS;
    while (wc.isLoading() && Date.now() < until && !signal?.aborted) await sleep(150);
    await sleep(250);
  }

  async goto(url: string, signal?: AbortSignal): Promise<void> {
    if (!isHttpUrl(url)) throw new WebError('Só abro endereços http ou https.');
    const wc = this.contents();
    const timer = setTimeout(() => wc.stop(), LOAD_TIMEOUT_MS);
    const onAbort = (): void => wc.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await wc.loadURL(url);
    } catch (e) {
      const msg = (e as Error).message;
      // ERR_ABORTED: a página redirecionou no meio do carregamento; o que importa é onde parou.
      if (!/ERR_ABORTED|\(-3\)/.test(msg)) throw new WebError(signal?.aborted ? 'Cancelado.' : `Não consegui abrir ${url.slice(0, 120)} (${msg.replace(/^.*?(ERR_[A-Z_]+).*$/s, '$1')}).`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    await this.settle(signal);
  }

  snapshot(maxElements = 80): Promise<PageSnapshot> {
    return this.call<PageSnapshot>('snapshot', maxElements);
  }

  info(target: string): Promise<ElementInfo | null> {
    return this.call<ElementInfo | null>('info', target);
  }

  async click(target: string, signal?: AbortSignal): Promise<void> {
    await this.act('click', target);
    await this.settle(signal);
  }

  fill(target: string, value: string): Promise<void> {
    return this.act('fill', target, value);
  }

  async submit(target: string | null, signal?: AbortSignal): Promise<void> {
    await this.act('submit', target);
    await this.settle(signal);
  }

  /** Aperta uma tecla na página (Enter, Tab, Escape, setas…). */
  async press(key: string, signal?: AbortSignal): Promise<void> {
    const wc = this.contents();
    const keyCode = key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1);
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode.length === 1 || keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await this.settle(signal);
  }

  async text(target?: string): Promise<string> {
    const r = await this.call<Result<string>>('text', target ?? null);
    if (!r?.ok) throw new WebError(r?.error ?? 'Não consegui ler a página.');
    return r.value ?? '';
  }

  async list(selector: string, attr?: string): Promise<string[]> {
    const r = await this.call<Result<string[]>>('list', selector, attr ?? null);
    if (!r?.ok) throw new WebError(r?.error ?? 'Não consegui ler a lista.');
    return r.value ?? [];
  }

  /** Espera um elemento aparecer (seletor ou texto). */
  async waitFor(target: string, timeoutMs = 15_000, signal?: AbortSignal): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (signal?.aborted) throw new WebError('Cancelado.');
      if (await this.call<boolean>('has', target).catch(() => false)) return;
      await sleep(300);
    }
    throw new WebError(`"${target.slice(0, 80)}" não apareceu na página em ${Math.round(timeoutMs / 1000)}s.`);
  }

  async screenshot(file: string): Promise<string> {
    const img = await this.contents().capturePage();
    writeFileSync(file, img.toPNG());
    return file;
  }

  close(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

const sessions = new Map<string, WebSession>();

export function webSession(partition: string): WebSession {
  let s = sessions.get(partition);
  if (!s) {
    s = new WebSession(partition);
    sessions.set(partition, s);
  }
  return s;
}

export function closeAllWebSessions(): void {
  for (const s of sessions.values()) s.close();
}

/** Partição do Pipo branco (chat) e de cada Pipo colorido. */
export const CHAT_PARTITION = 'persist:pipo-web';
export const pipoPartition = (slug: string): string => `persist:pipo-web-${slug}`;

const visible = new Map<string, BrowserWindow>();

/**
 * Janela de navegador à vista, com a mesma sessão (cookies) do dono: o usuário entra no site com a
 * senha dele, resolve um captcha ou só acompanha. O Pipo nunca digita senha de login.
 */
export function openVisible(partition: string, url: string, title: string, opts: { fresh?: boolean; beforeLoad?: (win: BrowserWindow) => void } = {}): BrowserWindow {
  const old = visible.get(partition);
  if (old && !old.isDestroyed()) {
    if (!opts.fresh) {
      if (isHttpUrl(url) && old.webContents.getURL() !== url) void old.loadURL(url).catch(() => undefined);
      old.show();
      old.focus();
      return old;
    }
    old.destroy();
  }
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    title,
    autoHideMenuBar: true,
    webPreferences: { session: webPartition(partition), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  hardenContents(win.webContents);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => {
    if (visible.get(partition) === win) visible.delete(partition);
  });
  visible.set(partition, win);
  // Quem grava o tráfego precisa começar antes da primeira requisição da página.
  opts.beforeLoad?.(win);
  if (isHttpUrl(url)) void win.loadURL(url).catch(() => undefined);
  return win;
}
