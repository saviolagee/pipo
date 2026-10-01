// Lado do app da ponte MCP: socket local que atende o shim stdio (stdio-entry.ts).
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { app } from 'electron';
import { paths } from '../paths';
import { newSocketPath, newToken, type BridgeRequest, type BridgeResponse } from './protocol';
import { callTool, toolDescriptors, type ToolCtx } from './tools';

let server: Server | null = null;
let socketPath = '';
let token = '';
const contexts = new Map<string, ToolCtx>();

/** Registra o contexto de uma chamada ao Claude (chat X, captura…) e devolve o id passado ao shim. */
export function openContext(ctx: ToolCtx): string {
  const id = randomBytes(8).toString('hex');
  contexts.set(id, ctx);
  return id;
}

export function closeContext(id: string): void {
  contexts.delete(id);
}

export function mcpConfigPath(): string {
  return join(paths.userData, 'pipo-mcp.json');
}

function shimPath(): string {
  // No app empacotado o shim fica fora do asar (asarUnpack) para o Electron-como-Node executá-lo.
  return join(__dirname, 'mcp-stdio.js').replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
}

function writeConfig(): void {
  const cfg = {
    mcpServers: {
      pipo: {
        type: 'stdio',
        command: process.execPath,
        args: [shimPath()],
        env: { ELECTRON_RUN_AS_NODE: '1', PIPO_MCP_SOCKET: socketPath, PIPO_MCP_TOKEN: token },
      },
    },
  };
  writeFileSync(mcpConfigPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function handleRequest(req: BridgeRequest): Promise<BridgeResponse> {
  if (req.token !== token) return { id: req.id, error: 'token inválido' };
  const ctx = contexts.get(req.ctx) ?? { mode: 'chat', conversationId: null };
  if (req.method === 'list_tools') return { id: req.id, tools: toolDescriptors(ctx) };
  const r = await callTool(req.name ?? '', req.args ?? {}, ctx);
  return { id: req.id, text: r.text, isError: r.isError };
}

export function startMcpBridge(): void {
  if (server) return;
  socketPath = newSocketPath();
  token = newToken();
  if (process.platform !== 'win32') rmSync(socketPath, { force: true });
  server = createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let req: BridgeRequest;
        try {
          req = JSON.parse(line) as BridgeRequest;
        } catch {
          continue;
        }
        void handleRequest(req)
          .catch((e) => ({ id: req.id, error: e instanceof Error ? e.message : String(e) }))
          .then((res) => {
            if (!sock.destroyed) sock.write(JSON.stringify(res) + '\n');
          });
      }
    });
    sock.on('error', () => undefined);
  });
  server.listen(socketPath, () => writeConfig());
  app.on('will-quit', () => {
    server?.close();
    if (process.platform !== 'win32') rmSync(socketPath, { force: true });
  });
}
