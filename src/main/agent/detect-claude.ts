// Detecção e teste de login do Claude Code (seção 3.2).
import type { ClaudeStatus } from '@shared/types';
import { emit } from '../bus';
import { findClaude, runClaude } from './claude-bin';

let status: ClaudeStatus = { state: 'checking' };
let inflight: Promise<ClaudeStatus> | null = null;

export function claudeStatus(): ClaudeStatus {
  return status;
}

const AUTH_HINTS = /(not logged in|log ?in|login|authenticat|unauthori[sz]ed|invalid api key|oauth|credential|\/login)/i;

/** Interpreta a saída do teste `claude -p ... --output-format json`. Exportado para testes. */
export function interpretLoginTest(r: { code: number | null; stdout: string; stderr: string; timedOut: boolean }, version: string | null): ClaudeStatus {
  if (r.timedOut) return { state: 'not_logged', version, message: 'O Claude não respondeu a tempo.' };
  const text = `${r.stdout}\n${r.stderr}`;
  const line = r.stdout
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (line) {
    try {
      const j = JSON.parse(line) as { is_error?: boolean; result?: string; subtype?: string };
      if (!j.is_error && typeof j.result === 'string') return { state: 'ok', version };
      const msg = j.result ?? j.subtype ?? 'erro';
      return { state: 'not_logged', version, message: msg };
    } catch {
      // cai no tratamento abaixo
    }
  }
  if (AUTH_HINTS.test(text)) return { state: 'not_logged', version, message: text.trim().slice(0, 200) };
  return { state: 'not_logged', version, message: text.trim().slice(0, 200) || `código ${r.code}` };
}

export async function checkClaude(cwd: string, force = false): Promise<ClaudeStatus> {
  if (inflight) return inflight;
  if (!force && status.state !== 'checking') return status;
  inflight = (async () => {
    const bin = findClaude(true);
    if (!bin) {
      status = { state: 'not_installed' };
      return status;
    }
    const v = await runClaude(bin, ['--version'], { cwd, timeoutMs: 15_000 });
    const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    if (v.code === -1) {
      status = { state: 'not_installed' };
      return status;
    }
    const r = await runClaude(bin, ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'], {
      cwd,
      stdin: 'responda apenas: ok',
      timeoutMs: 60_000,
    });
    status = interpretLoginTest(r, version);
    return status;
  })();
  try {
    const s = await inflight;
    emit('claude:status', s);
    return s;
  } finally {
    inflight = null;
  }
}

/**
 * Verificação leve no boot (sem gastar uso da assinatura): só procura o binário e a versão.
 * O teste de login real roda no onboarding, em "Testar de novo" e quando uma chamada falha.
 */
export async function quickCheckClaude(cwd: string): Promise<ClaudeStatus> {
  const bin = findClaude(true);
  if (!bin) {
    status = { state: 'not_installed' };
  } else {
    const v = await runClaude(bin, ['--version'], { cwd, timeoutMs: 15_000 });
    const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    status = v.code === -1 ? { state: 'not_installed' } : { state: 'ok', version };
  }
  emit('claude:status', status);
  return status;
}

/** Atualiza o status a partir de um erro de chamada real (ex.: sessão expirada). */
export function markClaudeStatus(s: ClaudeStatus): void {
  status = s;
  emit('claude:status', s);
}
