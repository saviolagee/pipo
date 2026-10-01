// Cliente MCP mínimo (stdio, JSON-RPC em linhas) para o passo `mcp`: sobe o servidor que o usuário
// adicionou ao Pipo, chama uma ferramenta e encerra. Config em pipos/<slug>/mcp.json.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { augmentedPath } from '../agent/claude-bin';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Aceita {"servers": {...}} ou o formato do Claude ({"mcpServers": {...}}). */
export function readMcpConfig(dir: string): Record<string, McpServerConfig> {
  const file = join(dir, 'mcp.json');
  if (!existsSync(file)) return {};
  const j = JSON.parse(readFileSync(file, 'utf8')) as { servers?: Record<string, McpServerConfig>; mcpServers?: Record<string, McpServerConfig> };
  return j.servers ?? j.mcpServers ?? {};
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpCallResult {
  text: string;
  /** Conteúdo como JSON, se a ferramenta devolveu JSON. */
  json: unknown;
  isError: boolean;
}

/** Chama uma ferramenta num servidor MCP stdio. */
export async function callMcpTool(cfg: McpServerConfig, tool: string, args: Record<string, unknown>, opts: { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<McpCallResult> {
  const child = spawn(cfg.command, cfg.args ?? [], {
    cwd: opts.cwd,
    env: { PATH: augmentedPath(), HOME: process.env.HOME ?? '', USERPROFILE: process.env.USERPROFILE ?? '', APPDATA: process.env.APPDATA ?? '', SystemRoot: process.env.SystemRoot ?? '', ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && /\.(cmd|bat)$|^npx$/i.test(cfg.command),
    windowsHide: true,
  });
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const waiting = new Map<number, (r: RpcResponse) => void>();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        if (typeof msg.id === 'number') waiting.get(msg.id)?.(msg);
      } catch {
        // linha que não é JSON-RPC (log do servidor): ignora
      }
    }
  });
  child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, (r) => {
        waiting.delete(id);
        if (r.error) reject(new Error(`MCP ${method}: ${r.error.message}`));
        else resolve(r.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  const timer = setTimeout(() => child.kill(), opts.timeoutMs);
  const onAbort = (): void => {
    child.kill();
  };
  opts.signal?.addEventListener('abort', onAbort);
  const died = new Promise<never>((_, reject) => {
    child.on('error', (e) => reject(new Error(`Não consegui iniciar o servidor MCP (${cfg.command}): ${e.message}`)));
    child.on('close', (code) => reject(new Error(`O servidor MCP fechou (código ${code}). ${stderr.trim().slice(-300)}`)));
  });
  try {
    await Promise.race([request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pipo', version: '2' } }), died]);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const result = (await Promise.race([request('tools/call', { name: tool, arguments: args }), died])) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    let json: unknown = result.structuredContent ?? null;
    if (json === null) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { text, json, isError: !!result.isError };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    child.stdin.end();
    child.kill();
  }
}
