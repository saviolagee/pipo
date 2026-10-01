// Protocolo JSON-lines entre o shim MCP (processo do Claude Code) e o app (socket local + token).
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BridgeRequest {
  id: number;
  token: string;
  ctx: string;
  method: 'list_tools' | 'call_tool';
  name?: string;
  args?: Record<string, unknown>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BridgeResponse {
  id: number;
  tools?: ToolDescriptor[];
  text?: string;
  isError?: boolean;
  error?: string;
}

export function newSocketPath(): string {
  const tag = randomBytes(6).toString('hex');
  if (process.platform === 'win32') return `\\\\.\\pipe\\pipo-mcp-${tag}`;
  // Caminho curto (limite de ~104 caracteres para sockets Unix no macOS).
  return join(tmpdir(), `pipo-${process.getuid?.() ?? 0}-${tag}.sock`);
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}
