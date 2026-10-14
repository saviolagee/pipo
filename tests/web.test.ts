import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { browserSends, describePlaybook, normalizePlaybook, validatePlaybook } from '../src/shared/plan-check';
import type { BrowserStep, PipoPlaybook } from '../src/shared/pipos';
import { UrlGuard, urlKey, urlsInText } from '../src/shared/web-guard';

const dir = mkdtempSync(join(tmpdir(), 'pipo-web-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  session: {},
}));
const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { execute } = await import('../src/main/pipos/runner');
const { describeAction } = await import('../src/main/browser/step');
const { unwrapResult } = await import('../src/main/browser/tools');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const env = { secrets: ['SITE_USER'], scripts: [], pipos: [], mcpServers: [] };
const step = (over: Partial<BrowserStep> = {}): BrowserStep => ({ kind: 'browser', key: 'site', title: 'Ler o site', url: 'https://loja.com/busca', actions: [{ do: 'read', as: 'texto' }], ...over });
const plan = (...steps: BrowserStep[]): PipoPlaybook => ({ steps, metrics: [], limits: { maxRunMinutes: 5, window: null } });

describe('endereços que o Pipo branco pode abrir sem perguntar', () => {
  it('acha os sites citados pelo usuário, com ou sem https', () => {
    expect(urlsInText('abre o site loja.com.br e depois https://docs.exemplo.io/guia?x=1.')).toEqual(['https://loja.com.br', 'https://docs.exemplo.io/guia?x=1']);
    expect(urlsInText('nada de site aqui, só 3.5 horas')).toEqual([]);
    expect(urlsInText('testa em http://127.0.0.1:8765/ e http://localhost:3000/app')).toEqual(['http://127.0.0.1:8765/', 'http://localhost:3000/app']);
  });

  it('site citado pelo usuário libera qualquer página dele; o resto só o endereço exato já visto', () => {
    const g = new UrlGuard();
    g.noteUserText('entra em loja.com.br pra mim');
    g.see('https://www.busca.com/resultado/1');
    expect(g.allowed('https://www.loja.com.br/produtos?pagina=2')).toBe(true);
    expect(g.allowed('https://busca.com/resultado/1/')).toBe(true);
    // Endereço montado pelo modelo, com dados na ponta: pede confirmação.
    expect(g.allowed('https://busca.com/resultado/1?dados=segredo')).toBe(false);
    expect(g.allowed('https://outro.com/')).toBe(false);
    expect(g.allowed('file:///c:/windows')).toBe(false);
  });

  it('compara endereços sem "www", sem a barra final e sem o trecho depois de #', () => {
    expect(urlKey('https://WWW.Site.com/a/#topo')).toBe(urlKey('http://site.com/a'));
    expect(urlKey('javascript:alert(1)')).toBeNull();
  });

  it('tira o endereço real de dentro do redirecionamento do buscador', () => {
    expect(unwrapResult('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fa%3Fb%3D1&rut=x')).toBe('https://exemplo.com/a?b=1');
    expect(unwrapResult(`https://www.bing.com/ck/a?u=a1${Buffer.from('https://exemplo.com/p').toString('base64url')}&ntb=1`)).toBe('https://exemplo.com/p');
    expect(unwrapResult('https://exemplo.com/direto')).toBe('https://exemplo.com/direto');
  });
});

describe('passo browser no plano', () => {
  it('só ler não é externo; preencher, enviar ou apertar tecla é', () => {
    const read = step();
    const send = step({ key: 'enviar', actions: [{ do: 'fill', target: 'Buscar', value: 'x' }, { do: 'submit' }] });
    expect([browserSends(read), browserSends(send)]).toEqual([false, true]);
    expect(normalizePlaybook(plan(read, send)).steps.map((s) => !!s.external)).toEqual([false, true]);
  });

  it('valida endereço, ações e nomes de saída; segredo pode ir num campo', () => {
    const ok = step({ actions: [{ do: 'fill', target: 'Usuário', value: '{{segredo.SITE_USER}}' }, { do: 'list', as: 'itens', target: '.item' }] });
    expect(validatePlaybook(plan(ok), env).filter((i) => i.level === 'error')).toEqual([]);
    const bad = step({ url: 'loja.com', actions: [{ do: 'click', target: ' ' }, { do: 'read', as: 'Texto Grande' }, { do: 'voar' } as never] });
    expect(validatePlaybook(plan(bad), env).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'URL inválida.',
      'A ação "click" precisa de "target".',
      'A ação "read" precisa de "as" (nome minúsculo, sem espaço).',
      'Ação de navegador desconhecida: voar.',
    ]);
    expect(describePlaybook(plan(ok))[0].detail).toBe('navegador · https://loja.com/busca · 2 ações');
  });

  it('o ensaio descreve a ação sem mostrar o segredo', () => {
    expect(describeAction({ do: 'fill', target: 'Senha', value: '{{segredo.SITE_PASS}}' })).toBe('preencher "Senha" com "••••"');
    expect(describeAction({ do: 'wait', for: '.pronto' })).toBe('esperar ".pronto" aparecer');
  });
});

describe('passo browser no executor', () => {
  function deps(over: Partial<Deps> = {}): Deps & { confirms: string[]; opened: string[] } {
    const confirms: string[] = [];
    const opened: string[] = [];
    return {
      confirms,
      opened,
      agent: async () => 'ok',
      confirm: async (o) => {
        confirms.push(o.message);
        return 'yes';
      },
      notify: () => undefined,
      gfetch: async () => {
        throw new Error('sem google');
      },
      fetch: (...a) => fetch(...a),
      handoff: async () => 'ok',
      askPipo: async () => 'ajuda',
      browser: async (s) => {
        opened.push(s.url);
        return { texto: 'Preço: R$ 20,00', url: s.url };
      },
      update: () => undefined,
      ...over,
    };
  }

  it('a saída do navegador alimenta os passos seguintes; quem envia pede permissão antes', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Navegador', color: 'cyan', personality: { mission: 'ler sites', tone: 'direto', never: [] } });
    const d = deps();
    const playbook: PipoPlaybook = {
      steps: [step(), step({ key: 'enviar', title: 'Mandar o pedido', actions: [{ do: 'fill', target: 'Obs', value: '{{passos.site.saida.texto}}' }, { do: 'submit' }] })],
      metrics: [],
      limits: { maxRunMinutes: 2, window: null },
    };
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook }, d);
    expect(run.status).toBe('done');
    expect(d.opened).toHaveLength(2);
    // Só o passo que preenche e envia passou pela confirmação (o plano nem tinha marcado "external").
    expect(d.confirms).toEqual(['Vou mandar o pedido. Pode?']);
  });

  it('sem navegador disponível, o passo falha com uma mensagem clara', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Sem navegador', color: 'red', personality: { mission: 'x', tone: 'x', never: [] } });
    const run = await execute({ pipo: p, version: 1, dryRun: false, trigger: 'manual', playbook: plan(step()) }, deps({ browser: undefined }));
    expect(run.status).toBe('failed');
    expect(run.error).toContain('navegador não está disponível');
  });
});
