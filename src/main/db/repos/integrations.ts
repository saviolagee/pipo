import type { IntegrationInfo, IntegrationProvider } from '@shared/types';
import { db } from '../index';
import { decrypt, encrypt } from '../../secrets';

interface Row {
  provider: IntegrationProvider;
  status: IntegrationInfo['status'];
  tokens_encrypted: Uint8Array | null;
  meta_json: string;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms. */
  expires_at: number;
  scope?: string;
}

export function getIntegration(provider: IntegrationProvider): { info: IntegrationInfo; tokens: Tokens | null; meta: Record<string, unknown> } {
  const r = db().get<Row>('SELECT provider, status, tokens_encrypted, meta_json FROM integrations WHERE provider = ?', provider);
  if (!r) return { info: { provider, status: 'disconnected', detail: null }, tokens: null, meta: {} };
  const meta = JSON.parse(r.meta_json) as Record<string, unknown>;
  const raw = r.tokens_encrypted ? decrypt(Buffer.from(r.tokens_encrypted).toString('utf8')) : null;
  return { info: { provider, status: r.status, detail: (meta.detail as string) ?? null }, tokens: raw ? (JSON.parse(raw) as Tokens) : null, meta };
}

export function saveIntegration(provider: IntegrationProvider, tokens: Tokens | null, meta: Record<string, unknown>, status: IntegrationInfo['status'] = tokens ? 'connected' : 'disconnected'): void {
  const enc = tokens ? Buffer.from(encrypt(JSON.stringify(tokens)), 'utf8') : null;
  db().run(
    `INSERT INTO integrations (provider, status, tokens_encrypted, meta_json, connected_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET status = excluded.status, tokens_encrypted = excluded.tokens_encrypted, meta_json = excluded.meta_json, connected_at = excluded.connected_at`,
    provider,
    status,
    enc,
    JSON.stringify(meta),
    tokens ? new Date().toISOString() : null,
  );
}
