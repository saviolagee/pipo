import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const { buildArgs, classifyError, parseStreamLine } = await import('../src/main/agent/claude-code-provider');
const { interpretLoginTest } = await import('../src/main/agent/detect-claude');

describe('ClaudeCodeProvider', () => {
  it('monta as flags sem --bare, com MCP estrito, ferramentas restritas e resume', () => {
    const args = buildArgs({ systemPromptFile: '/sp.md', sessionId: 'abc', readDirs: ['/files'], mcpConfig: '/mcp.json' });
    expect(args).not.toContain('--bare');
    expect(args.slice(0, 2)).toEqual(['-p', '--output-format']);
    expect(args).toEqual(expect.arrayContaining(['stream-json', '--verbose', '--include-partial-messages', '--strict-mcp-config', 'dontAsk']));
    expect(args[args.indexOf('--tools') + 1]).toBe('Read');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__pipo__*');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/files');
    expect(args.slice(-2)).toEqual(['--resume', 'abc']);
  });

  it('converte o NDJSON do stream-json em eventos', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Olá' } } }))).toEqual([{ type: 'delta', text: 'Olá' }]);
    expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__pipo__list_tasks' } } }))).toEqual([{ type: 'tool', name: 'mcp__pipo__list_tasks' }]);
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1' }))).toEqual([{ type: 'done', text: 'ok', sessionId: 's1' }]);
    expect(parseStreamLine('lixo')).toEqual([]);
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual([]);
  });

  it('classifica erros de login e de limite', () => {
    expect(classifyError('Invalid API key · Please run /login').code).toBe('not_logged');
    expect(classifyError('Claude usage limit reached').code).toBe('rate_limited');
    expect(classifyError('boom').code).toBe('failed');
  });

  it('interpreta o teste de login', () => {
    const ok = interpretLoginTest({ code: 0, stdout: '{"type":"result","is_error":false,"result":"ok"}', stderr: '', timedOut: false }, '2.1.0');
    expect(ok.state).toBe('ok');
    const bad = interpretLoginTest({ code: 1, stdout: '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}', stderr: '', timedOut: false }, '2.1.0');
    expect(bad.state).toBe('not_logged');
  });
});
