// "Site vira API": transforma o tráfego gravado de um site em chamadas que um passo `http` repete.
// Cookies e tokens nunca voltam para o modelo: viram segredos do Pipo e, no lugar, vai {{segredo.NOME}}.
// Funções puras: tests/site-api.test.ts.

/** Uma requisição gravada pelo navegador (XHR ou fetch). */
export interface RecordedCall {
  method: string;
  url: string;
  /** Tipo do recurso segundo o navegador (XHR, Fetch, Document…). */
  type: string;
  status: number | null;
  mime: string;
  headers: Record<string, string>;
  body: string | null;
  response: string | null;
}

/** O que o construtor recebe para escrever o passo `http`. */
export interface ApiCall {
  method: string;
  url: string;
  status: number | null;
  headers: Record<string, string>;
  body: string | null;
  resposta_exemplo: string | null;
}

export interface CaptureResult {
  calls: ApiCall[];
  /** Nome do segredo → valor, para guardar no cofre do Pipo. */
  secrets: Record<string, string>;
}

const TRACKERS = /(google-analytics|googletagmanager|doubleclick|facebook\.(com|net)|hotjar|sentry\.io|segment\.(io|com)|mixpanel|amplitude|clarity\.ms|newrelic|datadoghq|intercom|fullstory|bugsnag|cloudflareinsights)/i;
const DROP = /^(:|sec-|accept-encoding$|accept-language$|user-agent$|connection$|host$|content-length$|pragma$|cache-control$|priority$|dnt$|upgrade-insecure-requests$|if-none-match$|if-modified-since$)/i;
const SECRET = /^(cookie|authorization|proxy-authorization)$|token|csrf|xsrf|api-?key|auth|session|secret|signature/i;
const MAX_CALLS = 25;

const cut = (s: string | null, n: number): string | null => (s === null ? null : s.length > n ? `${s.slice(0, n)}…` : s);

/** "app.loja.com.br:8443" → "SITE_APP_LOJA_COM_BR_8443" (no máximo 40 letras). */
export function secretBase(host: string): string {
  return `SITE_${host.toUpperCase().replace(/^WWW\./, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 40).replace(/_+$/, '');
}

/** Nome do segredo de um cabeçalho: cookie → …_COOKIE, authorization → …_AUTH, x-csrf-token → …_X_CSRF_TOKEN. */
export function secretName(host: string, header: string): string {
  const h = header.toLowerCase();
  const suffix = h === 'cookie' ? 'COOKIE' : h === 'authorization' ? 'AUTH' : h.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `${secretBase(host)}_${suffix}`.slice(0, 64).replace(/_+$/, '');
}

export const isSecretHeader = (name: string): boolean => SECRET.test(name);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Mesmo site: o endereço termina com o domínio da página (sem contar "www."). */
function sameSite(host: string, pageHost: string): boolean {
  const page = pageHost.replace(/^www\./, '').split(':')[0];
  const h = host.split(':')[0];
  const root = page.split('.').slice(-2).join('.');
  return h === page || h.endsWith(`.${root}`) || h === root;
}

export function summarizeCapture(recorded: RecordedCall[], pageUrl: string): CaptureResult {
  const pageHost = hostOf(pageUrl) ?? '';
  const secrets: Record<string, string> = {};
  const byKey = new Map<string, RecordedCall>();
  for (const r of recorded) {
    const host = hostOf(r.url);
    if (!host || !/^(xhr|fetch)$/i.test(r.type) || TRACKERS.test(host)) continue;
    if (r.status !== null && (r.status < 200 || r.status >= 400)) continue;
    const reads = r.method.toUpperCase() === 'GET';
    // Leitura só interessa se devolve dados (JSON); envio interessa sempre.
    if (reads && !/json/i.test(r.mime)) continue;
    const u = new URL(r.url);
    // A mesma chamada repetida (com outra página, outro filtro) conta uma vez: fica a última.
    byKey.delete(`${r.method} ${u.origin}${u.pathname}`);
    byKey.set(`${r.method} ${u.origin}${u.pathname}`, r);
  }
  // As do próprio site primeiro; o que sobra do limite vai para as de terceiros.
  const kept = [...byKey.values()].sort((a, b) => Number(sameSite(hostOf(b.url) ?? '', pageHost)) - Number(sameSite(hostOf(a.url) ?? '', pageHost))).slice(0, MAX_CALLS);
  const calls = kept.map((r) => {
    const host = hostOf(r.url) as string;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(r.headers)) {
      const key = name.toLowerCase();
      if (DROP.test(key) || !value) continue;
      if (isSecretHeader(key)) {
        const secret = secretName(host, key);
        secrets[secret] = value;
        headers[name] = `{{segredo.${secret}}}`;
      } else if (/^(accept|content-type|origin|referer)$/.test(key) || key.startsWith('x-')) headers[name] = value;
    }
    return { method: r.method.toUpperCase(), url: r.url, status: r.status, headers, body: cut(r.body, 2000), resposta_exemplo: cut(r.response, 700) };
  });
  return { calls, secrets };
}

/** Segredos de sessão de site que um plano usa (para renovar depois de um novo login). */
export function siteSecretsIn(texts: string[]): string[] {
  const names = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\{\{\s*segredo\.(SITE_[A-Z0-9_]+)\s*\}\}/g)) names.add(m[1]);
  return [...names];
}
