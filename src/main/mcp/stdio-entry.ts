// Servidor MCP "pipo" (stdio). O Claude Code sobe este processo via --mcp-config; ele só repassa
// list_tools/call_tool para o app do Pipo pelo socket local. Roda com ELECTRON_RUN_AS_NODE=1.
import { connect, type Socket } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { BridgeRequest, BridgeResponse, ToolDescriptor } from './protocol';

const SOCKET = process.env.PIPO_MCP_SOCKET ?? '';
const TOKEN = process.env.PIPO_MCP_TOKEN ?? '';
const CTX = process.env.PIPO_MCP_CONTEXT ?? 'chat';

let sock: Socket | null = null;
let buf = '';
let nextId = 1;
const waiting = new Map<number, (r: BridgeResponse) => void>();

function ensureSocket(): Promise<Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  return new Promise((resolve, reject) => {
    const s = connect(SOCKET);
    s.setEncoding('utf8');
    s.once('connect', () => {
      sock = s;
      resolve(s);
    });
    s.once('error', reject);
    s.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as BridgeResponse;
          waiting.get(r.id)?.(r);
          waiting.delete(r.id);
        } catch {
          // linha inválida: ignora
        }
      }
    });
    s.on('close', () => {
      sock = null;
      for (const [id, fn] of waiting) fn({ id, isError: true, error: 'O Pipo fechou a conexão.' });
      waiting.clear();
    });
  });
}

async function call(req: Omit<BridgeRequest, 'id' | 'token' | 'ctx'>): Promise<BridgeResponse> {
  const s = await ensureSocket();
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    s.write(JSON.stringify({ ...req, id, token: TOKEN, ctx: CTX }) + '\n');
  });
}

async function main(): Promise<void> {
  const server = new Server({ name: 'pipo', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const r = await call({ method: 'list_tools' });
    return { tools: (r.tools ?? []) as ToolDescriptor[] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await call({ method: 'call_tool', name: req.params.name, args: (req.params.arguments ?? {}) as Record<string, unknown> });
    if (r.error) return { content: [{ type: 'text', text: r.error }], isError: true };
    return { content: [{ type: 'text', text: r.text ?? '' }], isError: !!r.isError };
  });

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`[pipo-mcp] ${String(e)}\n`);
  process.exit(1);
});
