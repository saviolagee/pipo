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

interface McpOpts {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

type Request = (method: string, params: unknown) => Promise<unknown>;

/** Sobe o servidor, faz o aperto de mão do MCP, roda `fn` com ele e encerra. */
async function withServer<T>(cfg: McpServerConfig, opts: McpOpts, fn: (request: Request) => Promise<T>): Promise<T> {
  const child = spawn(cfg.command, cfg.args ?? [], {
    cwd: opts.cwd,
    env: { PATH: augmentedPath(), HOME: process.env.HOME ?? '', USERPROFILE: process.env.USERPROFILE ?? '', APPDATA: process.env.APPDATA ?? '', LOCALAPPDATA: process.env.LOCALAPPDATA ?? '', SystemRoot: process.env.SystemRoot ?? '', ...opts.env },
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

  const send: Request = (method, params) =>
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
  // O servidor é encerrado no fim de toda chamada: esse "fechou" já não é erro de ninguém.
  died.catch(() => undefined);
  const request: Request = (method, params) => Promise.race([send(method, params), died]);
  try {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pipo', version: '3' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return await fn(request);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    child.stdin.end();
    child.kill();
  }
}

/** Chama uma ferramenta num servidor MCP stdio. */
export function callMcpTool(cfg: McpServerConfig, tool: string, args: Record<string, unknown>, opts: McpOpts): Promise<McpCallResult> {
  return withServer(cfg, opts, async (request) => {
    const result = (await request('tools/call', { name: tool, arguments: args })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
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
  });
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** Nomes dos argumentos (os obrigatórios com *). */
  args: string[];
}

/** Lista as ferramentas de um servidor MCP, para o construtor escrever passos `mcp` com os nomes certos. */
export function listMcpTools(cfg: McpServerConfig, opts: McpOpts): Promise<McpToolInfo[]> {
  return withServer(cfg, opts, async (request) => {
    const r = (await request('tools/list', {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }> };
    return (r.tools ?? []).map((t) => ({
      name: t.name,
      description: (t.description ?? '').replace(/\s+/g, ' ').slice(0, 240),
      args: Object.keys(t.inputSchema?.properties ?? {}).map((k) => (t.inputSchema?.required?.includes(k) ? `${k}*` : k)),
    }));
  });
}
