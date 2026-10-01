// Gatilhos por evento (Fase 23): arquivo novo numa pasta, e-mail novo com marcador, fim de reunião e
// webhook local (127.0.0.1). Cada evento vira uma execução com o evento como {{entrada}}.
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { basename, join } from 'node:path';
import type { EventSpec, PipoTrigger } from '@shared/pipos';
import { getKV, setKV } from '../db/repos/settings';
import { meetingHooks } from '../insights/context-reactions';
import { googleConnected, googleFetch } from '../integrations/google-auth';
import { every } from '../scheduler';
import { handle } from '../ipc';
import { startRun } from './deps';
import { getPipo, listTriggers, markTriggerFired, updateTrigger } from './repo';
import { blockedReason } from './triggers';

export const WEBHOOK_PORT = 43822;

async function fire(t: PipoTrigger, input: unknown, label: string): Promise<void> {
  const p = getPipo(t.pipoId);
  if (!p) return;
  if (blockedReason(p, new Date())) return;
  markTriggerFired(t.id);
  await startRun(p.id, { trigger: `event:${label}`, input }).catch((e) => console.warn('[eventos]', e));
}

const eventTriggers = (type: EventSpec['type']): PipoTrigger[] => listTriggers().filter((t) => t.kind === 'event' && t.enabled && (t.spec as EventSpec).type === type);

// ---------- Pasta ----------
const watchers = new Map<number, FSWatcher>();
const seenFiles = new Map<string, number>();

function syncFolderWatchers(): void {
  const wanted = new Map(eventTriggers('folder').map((t) => [t.id, t]));
  for (const [id, w] of watchers) {
    if (!wanted.has(id)) {
      w.close();
      watchers.delete(id);
    }
  }
  for (const [id, t] of wanted) {
    if (watchers.has(id)) continue;
    const dir = (t.spec as { path: string }).path;
    if (!dir || !existsSync(dir)) continue;
    try {
      const w = watch(dir, (_ev, name) => {
        if (!name || name.startsWith('.') || /\.(tmp|crdownload|part)$/i.test(name)) return;
        const full = join(dir, name);
        // Espera o arquivo terminar de ser escrito e não dispara duas vezes pelo mesmo arquivo.
        setTimeout(() => {
          if (!existsSync(full) || !statSync(full).isFile()) return;
          const k = `${id}:${full}`;
          if (Date.now() - (seenFiles.get(k) ?? 0) < 60_000) return;
          seenFiles.set(k, Date.now());
          void fire(t, { arquivo: full, nome: basename(full), tamanho: statSync(full).size }, 'pasta');
        }, 2000);
      });
      watchers.set(id, w);
    } catch (e) {
      console.warn('[eventos] não consegui observar a pasta', dir, e);
    }
  }
}

// ---------- E-mail com marcador ----------
async function checkEmail(): Promise<void> {
  const triggers = eventTriggers('email_label');
  if (!triggers.length || !googleConnected()) return;
  for (const t of triggers) {
    const label = (t.spec as { label: string }).label;
    const q = new URLSearchParams({ q: `label:${label.replace(/\s+/g, '-')} newer_than:2d`, maxResults: '20' });
    const list = await googleFetch<{ messages?: Array<{ id: string }> }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${q.toString()}`).catch(() => null);
    if (!list) continue;
    const key = `pipo:event:email:${t.id}`;
    const seen = new Set(getKV<string[]>(key, []));
    const first = seen.size === 0 && !t.lastFiredAt;
    const fresh = (list.messages ?? []).filter((m) => !seen.has(m.id));
    for (const m of list.messages ?? []) seen.add(m.id);
    setKV(key, [...seen].slice(-500));
    // Na primeira olhada só marca o que já existia; dispara a partir dos próximos.
    if (first || !fresh.length) continue;
    const emails = [];
    for (const m of fresh.slice(0, 10)) {
      const full = await googleFetch<{ snippet: string; payload: { headers: Array<{ name: string; value: string }> } }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null);
      if (!full) continue;
      const h = (n: string): string => full.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
      emails.push({ id: m.id, de: h('From'), assunto: h('Subject'), trecho: full.snippet, data: h('Date') });
    }
    if (emails.length) await fire(t, { emails }, 'email');
  }
}

// ---------- Webhook local ----------
let server: Server | null = null;

export function webhookUrl(token: string): string {
  return `http://127.0.0.1:${WEBHOOK_PORT}/pipo/${token}`;
}

function ensureWebhookServer(): void {
  const hooks = eventTriggers('webhook');
  if (!hooks.length) {
    server?.close();
    server = null;
    return;
  }
  if (server) return;
  server = createServer((req, res) => {
    const m = /^\/pipo\/([a-f0-9]{24,64})$/.exec(req.url ?? '');
    const t = m ? eventTriggers('webhook').find((x) => (x.spec as { token: string }).token === m[1]) : null;
    if (!t || (req.method !== 'POST' && req.method !== 'GET')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      let input: unknown = body;
      try {
        input = body ? JSON.parse(body) : null;
      } catch {
        // texto puro
      }
      void fire(t, input, 'webhook');
      res.writeHead(202, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });
  server.on('error', (e) => console.warn('[eventos] webhook:', e));
  // Só na máquina: nada de fora alcança.
  server.listen(WEBHOOK_PORT, '127.0.0.1');
}

/** Garante um token para cada webhook (gerado ao contratar). */
export function ensureWebhookTokens(): void {
  for (const t of eventTriggers('webhook')) {
    const spec = t.spec as { type: 'webhook'; token?: string };
    if (!spec.token) updateTrigger(t.id, { spec: { type: 'webhook', token: randomBytes(16).toString('hex') } });
  }
}

export function syncEvents(): void {
  ensureWebhookTokens();
  syncFolderWatchers();
  ensureWebhookServer();
}

export function registerEvents(): void {
  handle('pipos:events', (pipoId) => {
    syncEvents();
    return listTriggers(pipoId)
      .filter((t) => t.kind === 'event')
      .map((t) => {
        const s = t.spec as EventSpec;
        return { id: t.id, type: s.type, label: s.type === 'folder' ? s.path : s.type === 'email_label' ? s.label : s.type === 'webhook' ? webhookUrl(s.token) : 'fim de reunião', lastFiredAt: t.lastFiredAt };
      });
  });
  meetingHooks.ended.push(() => {
    for (const t of eventTriggers('meeting_end')) void fire(t, { fim_da_reuniao: new Date().toISOString() }, 'reuniao');
  });
  every('pipoEvents', 60_000, () => syncEvents());
  every('pipoEmail', 2 * 60_000, () => checkEmail());
  setTimeout(syncEvents, 3000);
}
