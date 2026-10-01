import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-run-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo' },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`x${s}`), decryptString: (b: Buffer) => b.toString().slice(1) },
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { setPipoSecret } = await import('../src/main/pipos/secrets');
const { execute } = await import('../src/main/pipos/runner');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

function deps(over: Partial<Deps> = {}): Deps & { notes: string[]; confirms: string[] } {
  const notes: string[] = [];
  const confirms: string[] = [];
  return {
    notes,
    confirms,
    agent: async (o) => (o.prompt.includes('JSON') ? '```json\n{"assunto":"Oi Ana"}\n```' : 'ok'),
    confirm: async (o) => {
      confirms.push(o.message);
      return 'yes';
    },
    notify: (o) => {
      notes.push(o.title);
    },
    gfetch: async () => {
      throw new Error('sem google');
    },
    fetch: (...a) => fetch(...a),
    handoff: async () => 'ok',
    askPipo: async () => 'ajuda',
    update: () => undefined,
    ...over,
  };
}

function pipoWithScript(script: string): ReturnType<typeof repo.createPipo> {
  const p = repo.createPipo({ name: `Teste ${Math.random().toString(36).slice(2, 7)}`, color: 'orange', personality: { mission: 'testar', tone: 'direto', never: [] } });
  writeFileSync(join(repo.pipoDir(p.slug), 'scripts', 'puxar.js'), script);
  return p;
}

describe('executor de processos', () => {
  it('roda script → http → agent → confirm → branch → notify, com métricas e segredo mascarado', async () => {
    openDb(':memory:');
    const p = pipoWithScript(`const seco = process.env.PIPO_DRY_RUN; console.log(JSON.stringify({ leads: [{ email: 'ana@x.com', nome: 'Ana' }, { email: 'bia@x.com', nome: 'Bia' }], seco, token: process.env.API_TOKEN }));`);
    setPipoSecret(p.slug, 'API_TOKEN', 'segredo-super-123');
    const got: Array<{ auth: string; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got.push({ auth: String(req.headers.authorization), body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ enviados: 2 }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const d = deps();
    const run = await execute(
      {
        pipo: p,
        version: 1,
        dryRun: false,
        trigger: 'manual',
        playbook: {
          limits: { maxRunMinutes: 2 },
          metrics: [
            { key: 'leads', label: 'leads', from: '{{passos.puxar.saida.leads | length}}', stage: 1 },
            { key: 'enviados', label: 'enviados', from: '{{passos.enviar.saida.enviados}}', stage: 2 },
          ],
          steps: [
            { kind: 'script', key: 'puxar', title: 'Puxar leads', command: 'node', args: ['scripts/puxar.js'] },
            { kind: 'agent', key: 'assunto', title: 'Escrever assunto', prompt: 'Responda em JSON o assunto para {{passos.puxar.saida.leads[0].nome}}', json: true },
            { kind: 'confirm', key: 'ok', title: 'Confirmar envio', message: 'Enviar {{passos.puxar.saida.leads | length}} e-mails?' },
            { kind: 'http', key: 'enviar', title: 'Enviar', external: true, method: 'POST', url: `http://127.0.0.1:${port}/send`, headers: { Authorization: 'Bearer {{segredo.API_TOKEN}}' }, body: '{"assunto": "{{passos.assunto.saida.assunto}}", "leads": {{passos.puxar.saida.leads | json}}}' },
            { kind: 'branch', key: 'algum', title: 'Enviou algum?', if: '{{passos.enviar.saida.enviados}} == 0', then: 'end' },
            { kind: 'notify', key: 'avisar', title: 'Avisar', body: 'Foram {{passos.enviar.saida.enviados}}' },
          ],
        },
      },
      d,
    );
    server.close();
    expect(run.status).toBe('done');
    expect(run.metrics).toEqual({ leads: 2, enviados: 2 });
    expect(run.summary).toBe(`${p.name}: 2 leads, 2 enviados.`);
    expect(d.confirms).toEqual(['Enviar 2 e-mails?']);
    expect(got[0].auth).toBe('Bearer segredo-super-123');
    expect(JSON.parse(got[0].body)).toEqual({ assunto: 'Oi Ana', leads: [{ email: 'ana@x.com', nome: 'Ana' }, { email: 'bia@x.com', nome: 'Bia' }] });
    expect(d.notes).toEqual(['Avisar', run.summary]);
    // O segredo nunca fica nos logs da execução (saída do script vazou o token de propósito).
    const steps = repo.runSteps(run.id);
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(JSON.stringify(steps)).not.toContain('segredo-super-123');
    expect(readFileSync(join(repo.pipoDir(p.slug), 'runs', String(run.id), 'puxar.json'), 'utf8')).not.toContain('segredo-super-123');
  });

  it('modo seco: script recebe PIPO_DRY_RUN=1, POST externo não sai e confirmação não é pedida', async () => {
    openDb(':memory:');
    const p = pipoWithScript(`console.log(JSON.stringify({ seco: process.env.PIPO_DRY_RUN }))`);
    const fetchSpy = vi.fn();
    const d = deps({ fetch: fetchSpy as unknown as typeof fetch });
    const run = await execute(
      {
        pipo: p,
        version: 0,
        dryRun: true,
        trigger: 'rehearsal',
        playbook: {
          limits: { maxRunMinutes: 1 },
          metrics: [],
          steps: [
            { kind: 'script', key: 's', title: 'S', command: 'node', args: ['scripts/puxar.js'] },
            { kind: 'confirm', key: 'c', title: 'C', message: 'pode?' },
            { kind: 'http', key: 'h', title: 'H', external: true, method: 'POST', url: 'http://127.0.0.1:9/x', body: '{"a":1}' },
          ],
        },
      },
      d,
    );
    expect(run.status).toBe('done');
    expect(repo.runSteps(run.id)[0].preview).toContain('"seco":"1"');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(d.confirms).toEqual([]);
    expect(d.notes).toEqual([]);
  });

  it('recusar a confirmação cancela; ação externa sem confirmar pede permissão', async () => {
    openDb(':memory:');
    const p = pipoWithScript('console.log(1)');
    const run = await execute(
      { pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook: { limits: { maxRunMinutes: 1 }, metrics: [], steps: [{ kind: 'http', key: 'h', title: 'Postar no blog', external: true, method: 'POST', url: 'http://127.0.0.1:9/x' }] } },
      deps({ confirm: async () => 'no' }),
    );
    expect(run.status).toBe('cancelled');
    expect(repo.runSteps(run.id)[0].status).toBe('skipped');
  });

  it('cancelar no meio mata o processo filho', async () => {
    openDb(':memory:');
    const p = pipoWithScript(`setTimeout(() => console.log('fim'), 30000)`);
    const { cancelRun } = await import('../src/main/pipos/runner');
    let runId = 0;
    const started = Date.now();
    const pr = execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook: { limits: { maxRunMinutes: 1 }, metrics: [], steps: [{ kind: 'script', key: 'lento', title: 'Lento', command: 'node', args: ['scripts/puxar.js'] }] } }, deps(), (id) => (runId = id));
    await new Promise((r) => setTimeout(r, 400));
    expect(cancelRun(runId)).toBe(true);
    const run = await pr;
    expect(run.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('script fora de scripts/ é recusado; 3 falhas seguidas pausam o Pipo', async () => {
    openDb(':memory:');
    const p = pipoWithScript('process.exit(2)');
    const bad = { pipo: p, version: 1, dryRun: false, trigger: 'schedule', playbook: { limits: { maxRunMinutes: 1 }, metrics: [], steps: [{ kind: 'script' as const, key: 'x', title: 'X', command: 'node', args: ['../../../etc/passwd'] }] } };
    const r1 = await execute(bad, deps());
    expect(r1.error).toContain('scripts/');
    const fail = { ...bad, playbook: { ...bad.playbook, steps: [{ kind: 'script' as const, key: 'x', title: 'X', command: 'node', args: ['scripts/puxar.js'] }] } };
    await execute(fail, deps());
    const d = deps();
    await execute(fail, d);
    expect(repo.getPipo(p.id)?.paused).toBe(true);
    expect(d.notes.some((n) => n.includes('pausou'))).toBe(true);
  });

  it('passo mcp chama um servidor MCP stdio do Pipo', async () => {
    openDb(':memory:');
    const p = pipoWithScript('');
    const server = `const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => { const m = JSON.parse(l); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't', version: '1' } }
    : { content: [{ type: 'text', text: JSON.stringify({ eco: m.params.arguments.texto, token: process.env.TK }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });`;
    writeFileSync(join(repo.pipoDir(p.slug), 'eco.js'), server);
    writeFileSync(join(repo.pipoDir(p.slug), 'mcp.json'), JSON.stringify({ mcpServers: { eco: { command: process.execPath, args: ['eco.js'], env: { TK: '{{segredo.TK}}' } } } }));
    setPipoSecret(p.slug, 'TK', 'tk-12345');
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook: { limits: { maxRunMinutes: 1 }, metrics: [], steps: [{ kind: 'mcp', key: 'm', title: 'Eco', server: 'eco', tool: 'eco', args: '{"texto": "{{pipo.nome}}"}' }] } }, deps());
    expect(run.status).toBe('done');
    const out = JSON.parse(readFileSync(join(repo.pipoDir(p.slug), 'runs', String(run.id), 'm.json'), 'utf8'));
    expect(out).toEqual({ eco: p.name, token: '••••' });
  });
});

describe('aprovação em lote', () => {
  it('itens pulados saem e o texto editado volta para o campo certo', async () => {
    const { applyDecisions, describeItem } = await import('../src/main/pipos/deps');
    const list = [
      { email: 'a@x.com', assunto: 'Oi A', texto: 'Olá A' },
      { email: 'b@x.com', assunto: 'Oi B', texto: 'Olá B' },
      { email: 'c@x.com', assunto: 'Oi C', texto: 'Olá C' },
    ];
    expect(describeItem(list[0])).toEqual({ title: 'Oi A · a@x.com', detail: 'Olá A', field: 'texto' });
    const out = applyDecisions(list, [{ index: 0, keep: true }, { index: 1, keep: false }, { index: 2, keep: true, detail: 'Olá C, revisado' }]);
    expect(out).toEqual([list[0], { ...list[2], texto: 'Olá C, revisado' }]);
  });

  it('o passo confirm com lista entrega só os aprovados para o próximo passo', async () => {
    openDb(':memory:');
    const p = pipoWithScript(`console.log(JSON.stringify([{email:'a@x.com'},{email:'b@x.com'},{email:'c@x.com'}]))`);
    const sent: unknown[] = [];
    const run = await execute(
      {
        pipo: p,
        version: 1,
        dryRun: false,
        trigger: 'manual',
        playbook: {
          limits: { maxRunMinutes: 1 },
          metrics: [{ key: 'enviados', label: 'enviados', from: '{{passos.revisar.saida.itens | length}}' }],
          steps: [
            { kind: 'script', key: 'puxar', title: 'Puxar', command: 'node', args: ['scripts/puxar.js'] },
            { kind: 'confirm', key: 'revisar', title: 'Revisar', message: 'Enviar?', list: '{{passos.puxar.saida}}' },
            { kind: 'notify', key: 'fim', title: '{{passos.revisar.saida.itens | length}} aprovados' },
          ],
        },
      },
      deps({
        confirm: async (o) => ({ answer: 'yes', items: (o.list ?? []).slice(1) }),
        notify: (o) => void sent.push(o.title),
      }),
    );
    expect(run.status).toBe('done');
    expect(run.metrics.enviados).toBe(2);
    expect(sent[0]).toBe('2 aprovados');
  });
});
