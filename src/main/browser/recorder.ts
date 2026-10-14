// Grava as requisições (XHR e fetch) que uma página faz, pelo protocolo de depuração do Chromium.
// É o que alimenta o "site vira API": o usuário usa o site uma vez e o Pipo aprende as chamadas.
import type { WebContents } from 'electron';
import type { RecordedCall } from '@shared/site-api';

interface Pending {
  method: string;
  url: string;
  type: string;
  headers: Record<string, string>;
  body: string | null;
  status: number | null;
  mime: string;
  response: string | null;
}

const MAX_REQUESTS = 400;
const MAX_BODY = 20_000;

export interface Recorder {
  /** Para de gravar e devolve o que foi visto, na ordem em que aconteceu. */
  stop: () => Promise<RecordedCall[]>;
}

export function startRecording(wc: WebContents): Recorder {
  const dbg = wc.debugger;
  const seen = new Map<string, Pending>();
  const reads: Array<Promise<void>> = [];
  const entry = (id: string): Pending => {
    let p = seen.get(id);
    if (!p) {
      p = { method: 'GET', url: '', type: '', headers: {}, body: null, status: null, mime: '', response: null };
      if (seen.size < MAX_REQUESTS) seen.set(id, p);
    }
    return p;
  };

  const onMessage = (_e: unknown, method: string, params: Record<string, unknown>): void => {
    const id = String(params.requestId ?? '');
    if (!id) return;
    if (method === 'Network.requestWillBeSent') {
      const req = params.request as { url: string; method: string; headers: Record<string, string>; postData?: string };
      const p = entry(id);
      p.method = req.method;
      p.url = req.url;
      p.type = String(params.type ?? '');
      // Os cabeçalhos "extras" (com o cookie) podem ter chegado antes: eles valem mais.
      p.headers = { ...req.headers, ...p.headers };
      p.body = req.postData ? req.postData.slice(0, MAX_BODY) : null;
    } else if (method === 'Network.requestWillBeSentExtraInfo') {
      const p = entry(id);
      p.headers = { ...p.headers, ...(params.headers as Record<string, string>) };
    } else if (method === 'Network.responseReceived') {
      const res = params.response as { status: number; mimeType: string };
      const p = entry(id);
      p.status = res.status;
      p.mime = res.mimeType ?? '';
      if (!p.type) p.type = String(params.type ?? '');
    } else if (method === 'Network.loadingFinished') {
      const p = seen.get(id);
      if (!p || !/^(xhr|fetch)$/i.test(p.type) || !/json|text/i.test(p.mime)) return;
      reads.push(
        dbg
          .sendCommand('Network.getResponseBody', { requestId: id })
          .then((r: { body?: string; base64Encoded?: boolean }) => {
            if (r.body && !r.base64Encoded) p.response = r.body.slice(0, MAX_BODY);
          })
          .catch(() => undefined),
      );
    }
  };

  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    dbg.on('message', onMessage);
    void dbg.sendCommand('Network.enable', { maxPostDataSize: 65_536 }).catch(() => undefined);
  } catch (e) {
    throw new Error(`Não consegui gravar o tráfego da página (${(e as Error).message}).`);
  }

  return {
    stop: async () => {
      await Promise.allSettled(reads);
      try {
        dbg.removeListener('message', onMessage);
        if (dbg.isAttached()) dbg.detach();
      } catch {
        // A janela já fechou: não há o que desligar.
      }
      return [...seen.values()].filter((p) => p.url).map((p) => ({ method: p.method, url: p.url, type: p.type, status: p.status, mime: p.mime, headers: p.headers, body: p.body, response: p.response }));
    },
  };
}
