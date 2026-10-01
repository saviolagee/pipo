// OAuth com loopback local (http://127.0.0.1:<porta>/callback) + PKCE, para Google e Spotify.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const PAGE = (ok: boolean, msg: string): string => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pipo</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#f4f4f5;font-family:system-ui,sans-serif">
<div style="text-align:center"><div style="width:64px;height:48px;margin:0 auto 16px;background:#fff;border-radius:16px;position:relative">
<span style="position:absolute;left:18px;top:18px;width:5px;height:8px;border-radius:3px;background:#000"></span>
<span style="position:absolute;right:18px;top:18px;width:5px;height:8px;border-radius:3px;background:#000"></span></div>
<h2 style="font-weight:600">${ok ? 'Conectado!' : 'Não deu certo'}</h2><p style="color:#a1a1aa">${msg}</p></div></body></html>`;

export interface LoopbackResult {
  code: string;
  redirectUri: string;
}

/**
 * Sobe o servidor de callback, abre o navegador e espera o código.
 * `port` 0 = porta livre (Google aceita qualquer porta de loopback); Spotify exige porta fixa registrada.
 */
export async function loopbackAuth(buildUrl: (redirectUri: string, state: string) => string, opts: { port?: number; timeoutMs?: number; open?: (url: string) => Promise<void> } = {}): Promise<LoopbackResult> {
  const state = base64url(randomBytes(16));
  let server: Server | null = null;
  try {
    const result = await new Promise<LoopbackResult>((resolve, reject) => {
      let redirectUri = '';
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const ok = !err && !!code && url.searchParams.get('state') === state;
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE(ok, ok ? 'Pode fechar esta aba e voltar pro Pipo.' : `Erro: ${err ?? 'resposta inválida'}. Tente de novo pelo Pipo.`));
        if (ok) resolve({ code: code as string, redirectUri });
        else reject(new Error(err === 'access_denied' ? 'Você cancelou a autorização.' : `Autorização falhou: ${err ?? 'estado inválido'}`));
      });
      server.on('error', reject);
      server.listen(opts.port ?? 0, '127.0.0.1', () => {
        const port = (server?.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = buildUrl(redirectUri, state);
        (opts.open ?? ((u: string) => shell.openExternal(u)))(authUrl).catch(reject);
      });
      setTimeout(() => reject(new Error('Tempo esgotado esperando a autorização (5 min).')), opts.timeoutMs ?? 5 * 60_000);
    });
    return result;
  } finally {
    (server as Server | null)?.close();
  }
}

export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}
