import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MCP_PRESETS, mcpPreset } from '../src/shared/mcp-presets';

const dir = mkdtempSync(join(tmpdir(), 'pipo-mcp-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo' },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
const { callMcpTool, listMcpTools } = await import('../src/main/pipos/mcp-client');

// Servidor MCP de mentira: uma ferramenta "eco" com um argumento obrigatório e um opcional.
const SERVER = `const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => { const m = JSON.parse(l); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't', version: '1' } }
    : m.method === 'tools/list' ? { tools: [{ name: 'eco', description: 'Devolve   o texto\\n recebido.', inputSchema: { type: 'object', properties: { texto: { type: 'string' }, vezes: { type: 'number' } }, required: ['texto'] } }] }
    : { content: [{ type: 'text', text: JSON.stringify({ eco: m.params.arguments.texto }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });`;
writeFileSync(join(dir, 'eco.js'), SERVER);
const cfg = { command: process.execPath, args: ['eco.js'] };
const opts = { cwd: dir, env: {}, timeoutMs: 20_000 };

describe('servidores MCP dos Pipos', () => {
  it('o REA vem conhecido, com versão fixa e sem rodar nada antes de o usuário aceitar', () => {
    const rea = mcpPreset(' REA ');
    expect(rea?.command).toBe('npx');
    expect(rea?.args).toEqual(['-y', 'rea-agents@6.4.0', 'mcp']);
    expect(mcpPreset('outro')).toBeNull();
    // Versão exata em todos: um registro permanente não pode mudar de pacote sozinho.
    for (const p of MCP_PRESETS) expect(p.args.some((a) => /@\d+\.\d+\.\d+$/.test(a))).toBe(true);
  });

  it('lista as ferramentas de um servidor, marcando os argumentos obrigatórios', async () => {
    expect(await listMcpTools(cfg, opts)).toEqual([{ name: 'eco', description: 'Devolve o texto recebido.', args: ['texto*', 'vezes'] }]);
  });

  it('chama a ferramenta e encerra o servidor sem deixar erro solto', async () => {
    const r = await callMcpTool(cfg, 'eco', { texto: 'oi' }, opts);
    expect(r).toEqual({ text: '{"eco":"oi"}', json: { eco: 'oi' }, isError: false });
  });

  it('servidor que não sobe vira um erro claro', async () => {
    await expect(listMcpTools({ command: process.execPath, args: ['nao-existe.js'] }, opts)).rejects.toThrow(/servidor MCP fechou/);
  });
});
