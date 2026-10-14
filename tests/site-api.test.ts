import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redact, secretBase, secretName, siteSecretsIn, summarizeCapture, type RecordedCall } from '../src/shared/site-api';

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

  it('chamada de login fica de fora: a senha digitada nunca chega ao modelo', () => {
    const { calls, secrets } = summarizeCapture(
      [
        call({ url: 'https://app.loja.com/api/login', method: 'POST', body: '{"email":"savio@x.com","password":"minha-senha-123"}', response: '{"access_token":"jwt-abc"}' }),
        call({ url: 'https://app.loja.com/oauth/token', method: 'POST', type: 'Fetch', body: 'grant_type=password&username=savio&password=minha-senha-123' }),
        call({ url: 'https://app.loja.com/api/authors' }),
      ],
      'https://app.loja.com/login',
    );
    expect(calls.map((c) => c.url)).toEqual(['https://app.loja.com/api/authors']);
    expect(JSON.stringify({ calls, secrets })).not.toContain('minha-senha-123');
  });

  it('token no endereço ou no corpo vira segredo; na resposta de exemplo, some', () => {
    const { calls, secrets } = summarizeCapture(
      [
        call({ url: 'https://app.loja.com/api/pedidos?status=aberto&access_token=tok-url', method: 'POST', body: '{"cliente":"Ana","csrfToken":"csrf-body","shipping":"Rua A, 10","pin":1234}', response: '{"ok":true,"refresh_token":"tok-resp","cpf":"123.456.789-00","nome":"Ana"}' }),
        call({ url: 'https://app.loja.com/api/busca', method: 'POST', type: 'Fetch', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'q=bolinha&api_key=key-form' }),
      ],
      'https://app.loja.com/painel',
    );
    expect(calls[0].url).toBe('https://app.loja.com/api/pedidos?status=aberto&access_token={{segredo.SITE_APP_LOJA_COM_ACCESS_TOKEN}}');
    // Campo comum (até "shipping", que tem "pin" no meio) fica como está: o passo precisa dele.
    expect(calls[0].body).toBe('{"cliente":"Ana","csrfToken":"{{segredo.SITE_APP_LOJA_COM_CSRFTOKEN}}","shipping":"Rua A, 10","pin":"{{segredo.SITE_APP_LOJA_COM_PIN}}"}');
    expect(calls[0].resposta_exemplo).toBe('{"ok":true,"refresh_token":"••••","cpf":"••••","nome":"Ana"}');
    expect(calls[1].body).toBe('q=bolinha&api_key={{segredo.SITE_APP_LOJA_COM_API_KEY}}');
    expect(secrets).toEqual({ SITE_APP_LOJA_COM_ACCESS_TOKEN: 'tok-url', SITE_APP_LOJA_COM_CSRFTOKEN: 'csrf-body', SITE_APP_LOJA_COM_PIN: '1234', SITE_APP_LOJA_COM_API_KEY: 'key-form' });
    expect(JSON.stringify(calls)).not.toMatch(/tok-url|csrf-body|tok-resp|key-form|123\.456/);
    expect([isSensitiveKey('accessToken'), isSensitiveKey('user_password'), isSensitiveKey('shipping'), isSensitiveKey('description'), isSensitiveKey('opinion')]).toEqual([true, true, false, false, false]);
    expect(redact('a=1&senha=xyz')).toBe('a=1&senha=••••');
  });

  it('corta corpo e resposta longos', () => {
    const { calls } = summarizeCapture([call({ method: 'POST', body: 'x'.repeat(5000), response: 'y'.repeat(5000) })], 'https://app.loja.com/');
    expect([calls[0].body?.length, calls[0].resposta_exemplo?.length]).toEqual([2001, 701]);
  });

  it('acha no plano os segredos de sessão que precisam ser renovados', () => {
    expect(siteSecretsIn(['{"Cookie":"{{segredo.SITE_LOJA_COM_COOKIE}}"}', 'Bearer {{ segredo.SITE_LOJA_COM_AUTH }} e {{segredo.RESEND_API_KEY}}'])).toEqual(['SITE_LOJA_COM_COOKIE', 'SITE_LOJA_COM_AUTH']);
  });
});
