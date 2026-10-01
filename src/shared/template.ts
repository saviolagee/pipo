// Templates do plano de execução: {{passos.puxar.saida.leads}}, {{entrada.itens | length}},
// {{segredo.APIFY_TOKEN}} (só onde permitido). Funções puras: tests/pipo-template.test.ts.

export type TemplateCtx = Record<string, unknown>;

export class TemplateError extends Error {}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Lê um caminho "a.b[0].c" (com .length) de um objeto. */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (p === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = cur.length;
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Onde o runner põe o que os passos com onceBy já enviaram: {{lista | novos:<passo>}} filtra por isso. */
export const SENT_KEY = '__jaEnviados';

function applyFilter(v: unknown, filter: string, ctx: TemplateCtx): unknown {
  const f = filter.trim();
  if (f.startsWith('novos:')) {
    const sent = (ctx[SENT_KEY] as Record<string, { by: string; done: string[] }> | undefined)?.[f.slice(6).trim()];
    if (!Array.isArray(v) || !sent) return v;
    const done = new Set(sent.done);
    return v.filter((item) => !done.has(renderText(sent.by, { ...ctx, item }).trim()));
  }
  if (f === 'length' || f === 'count') return Array.isArray(v) || typeof v === 'string' ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
  if (f === 'json') return JSON.stringify(v);
  if (f === 'first') return Array.isArray(v) ? v[0] : v;
  if (f === 'last') return Array.isArray(v) ? v[v.length - 1] : v;
  if (f === 'number') return Number(v);
  if (f === 'upper') return String(v ?? '').toUpperCase();
  if (f === 'lower') return String(v ?? '').toLowerCase();
  if (f.startsWith('default:')) return v === undefined || v === null || v === '' ? f.slice(8).trim() : v;
  if (f.startsWith('join:')) return Array.isArray(v) ? v.join(f.slice(5)) : v;
  throw new TemplateError(`Filtro desconhecido: ${f}`);
}

export interface RenderOpts {
  /** Permite {{segredo.X}} (só em http/script/mcp). */
  allowSecrets?: boolean;
}

function resolveExpr(expr: string, ctx: TemplateCtx, opts: RenderOpts): unknown {
  const [path, ...filters] = expr.split('|');
  const p = path.trim();
  if (/^segredo\./.test(p) && !opts.allowSecrets) throw new TemplateError('Segredos só podem ser usados em passos script, http e mcp.');
  let v = getPath(ctx, p);
  for (const f of filters) v = applyFilter(v, f, ctx);
  return v;
}

/**
 * Renderiza um template. Se o texto inteiro for um único {{…}}, devolve o valor cru (objeto, número);
 * senão, interpola como texto (objetos viram JSON).
 */
export function render(template: string, ctx: TemplateCtx, opts: RenderOpts = {}): unknown {
  const single = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(template);
  if (single) return resolveExpr(single[1], ctx, opts);
  return template.replace(TOKEN, (_m, expr: string) => {
    const v = resolveExpr(expr, ctx, opts);
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

export function renderText(template: string, ctx: TemplateCtx, opts: RenderOpts = {}): string {
  const v = render(template, ctx, opts);
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Renderiza um JSON com templates nos valores de texto (ex.: args de MCP, corpo de http). */
export function renderJson(template: string, ctx: TemplateCtx, opts: RenderOpts = {}): unknown {
  const t = template.trim();
  if (!t) return undefined;
  if (!t.startsWith('{') && !t.startsWith('[')) return render(t, ctx, opts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    // JSON com {{…}} sem aspas: interpola como texto e tenta de novo.
    const txt = renderText(t, ctx, opts);
    try {
      return JSON.parse(txt);
    } catch {
      throw new TemplateError('JSON inválido no passo.');
    }
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.includes('{{') ? render(v, ctx, opts) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(parsed);
}

/** Referências {{…}} usadas num texto (para validar o plano: passo inexistente, segredo faltando). */
export function references(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((m) => m[1].split('|')[0].trim());
}

function literal(s: string): unknown {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === 'vazio' || t === '""' || t === "''") return t === 'null' ? null : '';
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^["']|["']$/g, '');
}

/** Condição simples do passo branch: "{{passos.puxar.saida.leads | length}} == 0". */
export function evaluate(condition: string, ctx: TemplateCtx): boolean {
  const m = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(condition.trim());
  if (!m) {
    const v = render(condition, ctx);
    return !!v && v !== 'false' && v !== '0' && !(Array.isArray(v) && v.length === 0);
  }
  const left = render(m[1], ctx);
  const right = m[3].includes('{{') ? render(m[3], ctx) : literal(m[3]);
  const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x));
  switch (m[2]) {
    case '==':
      return typeof right === 'number' ? num(left) === right : String(left ?? '') === String(right ?? '');
    case '!=':
      return typeof right === 'number' ? num(left) !== right : String(left ?? '') !== String(right ?? '');
    case '>':
      return num(left) > num(right);
    case '<':
      return num(left) < num(right);
    case '>=':
      return num(left) >= num(right);
    case '<=':
      return num(left) <= num(right);
  }
  return false;
}
