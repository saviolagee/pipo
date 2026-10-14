import { describe, expect, it } from 'vitest';
import { secretBase, secretName, siteSecretsIn, summarizeCapture, type RecordedCall } from '../src/shared/site-api';

const call = (over: Partial<RecordedCall>): RecordedCall => ({ method: 'GET', url: 'https://app.loja.com/api/pedidos', type: 'XHR', status: 200, mime: 'application/json', headers: {}, body: null, response: '{"pedidos":[]}', ...over });

describe('site vira API', () => {
  it('nomes de segredo saem do site e do cabeçalho', () => {
    expect(secretBase('www.Loja.com.br:8443')).toBe('SITE_LOJA_COM_BR_8443');
    expect(secretName('app.loja.com', 'Cookie')).toBe('SITE_APP_LOJA_COM_COOKIE');
    expect(secretName('app.loja.com', 'authorization')).toBe('SITE_APP_LOJA_COM_AUTH');
    expect(secretName('app.loja.com', 'X-CSRF-Token')).toBe('SITE_APP_LOJA_COM_X_CSRF_TOKEN');
    expect(secretName(`${'sub.'.repeat(20)}loja.com`, 'x-very-long-custom-session-header-name').length).toBeLessThanOrEqual(64);
  });

  it('cookies e tokens viram segredos; o modelo só recebe o nome deles', () => {
    const { calls, secrets } = summarizeCapture(
      [
        call({
          headers: { Cookie: 'sessao=abc123; tema=escuro', Authorization: 'Bearer tok-999', 'X-CSRF-Token': 'csrf-1', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Chrome', 'sec-ch-ua': 'x', Accept: 'application/json', ':authority': 'app.loja.com' },
        }),
      ],
      'https://app.loja.com/painel',
    );
    expect(secrets).toEqual({ SITE_APP_LOJA_COM_COOKIE: 'sessao=abc123; tema=escuro', SITE_APP_LOJA_COM_AUTH: 'Bearer tok-999', SITE_APP_LOJA_COM_X_CSRF_TOKEN: 'csrf-1' });
    expect(calls[0].headers).toEqual({
      Cookie: '{{segredo.SITE_APP_LOJA_COM_COOKIE}}',
      Authorization: '{{segredo.SITE_APP_LOJA_COM_AUTH}}',
      'X-CSRF-Token': '{{segredo.SITE_APP_LOJA_COM_X_CSRF_TOKEN}}',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    });
    expect(JSON.stringify(calls)).not.toMatch(/abc123|tok-999|csrf-1/);
  });

  it('fica só o que é dado do site: sem página, imagem, rastreador, erro nem repetição', () => {
    const { calls } = summarizeCapture(
      [
        call({ type: 'Document', url: 'https://app.loja.com/painel', mime: 'text/html' }),
        call({ url: 'https://www.google-analytics.com/collect', method: 'POST' }),
        call({ url: 'https://app.loja.com/api/quebrado', status: 500 }),
        call({ url: 'https://app.loja.com/pedaco.html', mime: 'text/html' }),
        call({ url: 'https://app.loja.com/api/pedidos?pagina=1' }),
        call({ url: 'https://app.loja.com/api/pedidos?pagina=2' }),
        call({ url: 'https://cdn.terceiro.io/config', type: 'Fetch' }),
        call({ url: 'https://app.loja.com/api/pedidos', method: 'POST', type: 'Fetch', mime: 'text/plain', body: '{"cliente":"Ana"}' }),
      ],
      'https://app.loja.com/painel',
    );
    // Do próprio site primeiro; a leitura repetida conta uma vez (a última); o envio fica mesmo sem JSON na resposta.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://app.loja.com/api/pedidos?pagina=2', 'POST https://app.loja.com/api/pedidos', 'GET https://cdn.terceiro.io/config']);
    expect(calls[1].body).toBe('{"cliente":"Ana"}');
  });

  it('corta corpo e resposta longos', () => {
    const { calls } = summarizeCapture([call({ method: 'POST', body: 'x'.repeat(5000), response: 'y'.repeat(5000) })], 'https://app.loja.com/');
    expect([calls[0].body?.length, calls[0].resposta_exemplo?.length]).toEqual([2001, 701]);
  });

  it('acha no plano os segredos de sessão que precisam ser renovados', () => {
    expect(siteSecretsIn(['{"Cookie":"{{segredo.SITE_LOJA_COM_COOKIE}}"}', 'Bearer {{ segredo.SITE_LOJA_COM_AUTH }} e {{segredo.RESEND_API_KEY}}'])).toEqual(['SITE_LOJA_COM_COOKIE', 'SITE_LOJA_COM_AUTH']);
  });
});
