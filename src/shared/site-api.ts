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
/** Chamadas de entrar no site: o Pipo não repete login (e o corpo delas leva a senha do usuário). */
const LOGIN_PATH = /(^|[/._-])(login|logon|signin|sign-in|signup|sign-up|auth|authenticate|authentication|oauth2?|authorize|token|session|sessions|password|senha|2fa|mfa|otp|verify|captcha)([/._-]|$)/i;
/** Palavras que, no nome de um campo, dizem que o valor nunca volta para o modelo. */
const SENSITIVE_WORDS = new Set(['password', 'passwd', 'pass', 'senha', 'pwd', 'secret', 'token', 'jwt', 'otp', 'pin', 'cvv', 'cvc', 'cpf', 'cnpj', 'ssn', 'credential', 'credentials', 'authorization', 'apikey', 'csrf', 'xsrf', 'signature', 'cartao']);
const SENSITIVE_PARTS = /password|senha|token|secret|apikey|creditcard|cardnumber|numerocartao/;
const JSON_PAIR = /"([^"\\]{1,60})"(\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d[\d.]*|true|false)/g;
const FORM_PAIR = /(^|[?&;])([^=&;\s]{1,60})=([^&;\s]*)/g;
const HIDDEN = '••••';

const cut = (s: string | null, n: number): string | null => (s === null ? null : s.length > n ? `${s.slice(0, n)}…` : s);

/** "accessToken", "user_password", "x-api-key" são sensíveis; "shipping" (tem "pin" no meio) não é. */
export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => SENSITIVE_WORDS.has(w)) || SENSITIVE_PARTS.test(words.join(''));
}

/** Recebe o nome do campo e o valor como estava escrito; devolve o que fica no lugar do valor. */
type Hide = (key: string, raw: string) => string;

/** Passa por todos os campos com nome de senha, token, cartão ou documento (JSON ou formulário). */
function hideSensitive(text: string, hide: Hide, form: boolean): string {
  const json = text.replace(JSON_PAIR, (m, key: string, sep: string, value: string) => (isSensitiveKey(key) ? `"${key}"${sep}"${hide(key, value.replace(/^"|"$/g, ''))}"` : m));
  if (!form) return json;
  return json.replace(FORM_PAIR, (m, pre: string, key: string, value: string) => (isSensitiveKey(decodeSafe(key)) ? `${pre}${key}=${hide(decodeSafe(key), value)}` : m));
}

const looksJson = (text: string): boolean => /^\s*[[{]/.test(text);

/** Troca por •••• o valor dos campos sensíveis (para o que só é mostrado, como o exemplo de resposta). */
export function redact(text: string | null): string | null {
  return text === null ? null : hideSensitive(text, () => HIDDEN, !looksJson(text));
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

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
    if (LOGIN_PATH.test(u.pathname)) continue;
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
    // No pedido, o valor sensível vai para o cofre e o passo usa o nome dele; na resposta, só some.
    const keep: Hide = (key, raw) => {
      const secret = secretName(host, key);
      secrets[secret] = raw;
      return `{{segredo.${secret}}}`;
    };
    const q = r.url.indexOf('?');
    const url = q < 0 ? r.url : `${r.url.slice(0, q)}${hideSensitive(r.url.slice(q), keep, true)}`;
    const body = r.body === null ? null : hideSensitive(r.body, keep, !looksJson(r.body));
    return { method: r.method.toUpperCase(), url, status: r.status, headers, body: cut(body, 2000), resposta_exemplo: cut(redact(r.response), 700) };
  });
  return { calls, secrets };
}

/** Segredos de sessão de site que um plano usa (para renovar depois de um novo login). */
export function siteSecretsIn(texts: string[]): string[] {
  const names = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\{\{\s*segredo\.(SITE_[A-Z0-9_]+)\s*\}\}/g)) names.add(m[1]);
  return [...names];
}
