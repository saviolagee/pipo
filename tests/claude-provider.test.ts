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
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }))).toEqual([{ type: 'model', model: 'claude-sonnet-5-5' }]);
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5-20251001', content: [] } }))).toEqual([{ type: 'model', model: 'claude-haiku-4-5-20251001' }]);
  });

  it('passa modelo, effort e fallback (Fase 14)', () => {
    const base = { systemPromptFile: '/sp.md', sessionId: null, readDirs: [], mcpConfig: '/mcp.json' };
    const sonnet = buildArgs({ ...base, model: 'sonnet', effort: 'medium' });
    expect(sonnet[sonnet.indexOf('--model') + 1]).toBe('sonnet');
    expect(sonnet[sonnet.indexOf('--effort') + 1]).toBe('medium');
    expect(sonnet[sonnet.indexOf('--fallback-model') + 1]).toBe('haiku');
    const opus = buildArgs({ ...base, model: 'opus', effort: 'high' });
    expect(opus[opus.indexOf('--fallback-model') + 1]).toBe('sonnet,haiku');
    const haiku = buildArgs({ ...base, model: 'haiku', effort: 'high' });
    expect(haiku).not.toContain('--effort');
    // "Mesmo do terminal": nenhuma flag de modelo.
    const def = buildArgs({ ...base, model: 'default', effort: 'high' });
    expect(def).not.toContain('--model');
    expect(def).not.toContain('--effort');
  });

  it('mostra o nome do modelo de forma legível', async () => {
    const { prettyModel } = await import('../src/shared/models');
    expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(prettyModel('claude-fable-5-1')).toBe('Fable 5.1');
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
