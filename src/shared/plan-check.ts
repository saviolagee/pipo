// Validação e descrição do plano de execução (usado pelo construtor e pelo card do plano).
import type { BrowserAction, PipoPlaybook, PipoStep, StepKind } from './pipos';
import { ACTIVITY_NAME } from './decide';
import { references } from './template';

export interface PlanIssue {
  level: 'error' | 'warn';
  step?: string;
  message: string;
}

const KINDS: StepKind[] = ['script', 'http', 'browser', 'research', 'mcp', 'sheet', 'agent', 'decide', 'confirm', 'branch', 'notify', 'handoff'];
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const BROWSER_DO: Array<BrowserAction['do']> = ['goto', 'click', 'fill', 'submit', 'press', 'wait', 'read', 'list', 'screenshot'];
/** Ações do navegador que podem enviar algo para o site. */
const SENDS: Array<BrowserAction['do']> = ['fill', 'submit', 'press'];

/** O passo de navegador preenche, envia ou aperta tecla (pode mandar algo para o site)? */
export function browserSends(s: PipoStep): boolean {
  return s.kind === 'browser' && (s.actions ?? []).some((a) => SENDS.includes(a.do));
}

/** Marca como externa toda ação que sai da máquina, mesmo que o plano tenha esquecido. */
export function normalizePlaybook(p: PipoPlaybook): PipoPlaybook {
  return {
    ...p,
    steps: p.steps.map((s) => {
      if (s.kind === 'http' && s.method !== 'GET') return { ...s, external: true };
      if (browserSends(s)) return { ...s, external: true };
      if (s.kind === 'sheet' && s.action !== 'read') return { ...s, external: true };
      if (s.kind === 'handoff') return { ...s, external: false };
      return s;
    }),
    limits: { maxRunMinutes: Math.min(120, Math.max(1, p.limits?.maxRunMinutes ?? 15)), window: p.limits?.window ?? null },
    metrics: p.metrics ?? [],
  };
}

function textsOf(s: PipoStep): string[] {
  switch (s.kind) {
    case 'script':
      return [...s.args, ...Object.values(s.env ?? {})];
    case 'http':
      return [s.url, s.body ?? '', ...Object.values(s.headers ?? {}), s.each ?? '', s.onceBy ?? ''];
    case 'browser':
      return [s.url, ...(s.actions ?? []).flatMap((a) => Object.values(a).filter((v): v is string => typeof v === 'string'))];
    case 'research':
      return [s.query ?? '', ...(s.sites ?? [])];
    case 'mcp':
      return [s.args];
    case 'sheet':
      return [s.spreadsheetId, s.range, s.rows ?? ''];
    case 'agent':
      return [s.prompt];
    case 'decide':
      return [s.state ?? '', s.question ?? '', ...(typeof s.options === 'string' ? [s.options] : Object.values(s.options ?? {}))];
    case 'confirm':
      return [s.message, s.preview ?? '', s.list ?? ''];
    case 'branch':
      return [s.if];
    case 'notify':
      return [s.title, s.body ?? ''];
    case 'handoff':
      return [s.payload];
  }
}

export function validatePlaybook(p: PipoPlaybook, env: { secrets: string[]; scripts: string[]; pipos: string[]; mcpServers: string[] }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (!p.steps.length) issues.push({ level: 'error', message: 'O plano não tem nenhum passo.' });
  const keys = new Set<string>();
  p.steps.forEach((s, i) => {
    const at = s.key || `#${i + 1}`;
    if (!KINDS.includes(s.kind)) issues.push({ level: 'error', step: at, message: `Tipo de passo desconhecido: ${String((s as { kind: unknown }).kind)}.` });
    if (!KEY.test(s.key ?? '')) issues.push({ level: 'error', step: at, message: 'A chave do passo precisa ser minúscula, sem espaço (ex.: puxar_leads).' });
    if (keys.has(s.key)) issues.push({ level: 'error', step: at, message: 'Chave repetida.' });
    keys.add(s.key);
    if (!s.title?.trim()) issues.push({ level: 'error', step: at, message: 'Passo sem título.' });
    const earlier = new Set(p.steps.slice(0, i).map((x) => x.key));
    for (const t of textsOf(s)) {
      for (const [, key] of t.matchAll(/\|\s*novos:\s*([a-z0-9_]+)/g))
        if (!p.steps.some((x) => x.key === key && x.kind === 'http' && x.each && x.onceBy))
          issues.push({ level: 'error', step: at, message: `"novos:${key}" precisa apontar para um passo http com "each" e "onceBy".` });
      for (const ref of references(t)) {
        const m = /^passos\.([a-z0-9_]+)/.exec(ref);
        if (m && !earlier.has(m[1])) issues.push({ level: 'error', step: at, message: `Usa {{${ref}}}, mas o passo "${m[1]}" não vem antes.` });
        const sec = /^segredo\.([A-Z0-9_]+)/.exec(ref);
        if (sec) {
          if (!['script', 'http', 'browser', 'mcp'].includes(s.kind)) issues.push({ level: 'error', step: at, message: 'Segredos só podem ser usados em passos script, http, browser e mcp.' });
          else if (!env.secrets.includes(sec[1])) issues.push({ level: 'warn', step: at, message: `Falta guardar o segredo ${sec[1]} (use request_secret).` });
        }
      }
    }
    switch (s.kind) {
      case 'script': {
        const file = (s.args[0] ?? '').replace(/^\.?\/?/, '');
        if (!['node', 'python', 'python3', 'powershell', 'pwsh', 'bash', 'sh'].includes(s.command)) issues.push({ level: 'error', step: at, message: `Interpretador não permitido: ${s.command}.` });
        if (!file.startsWith('scripts/')) issues.push({ level: 'error', step: at, message: 'O primeiro argumento precisa ser um arquivo em scripts/.' });
        else if (!env.scripts.includes(file.slice(8))) issues.push({ level: 'warn', step: at, message: `O arquivo ${file} ainda não existe (use write_script ou import_script).` });
        break;
      }
      case 'http':
        if (!/^https?:\/\//.test(s.url.replace(/\{\{[^}]+\}\}/g, 'x'))) issues.push({ level: 'error', step: at, message: 'URL inválida.' });
        if (s.onceBy && !s.each) issues.push({ level: 'error', step: at, message: '"onceBy" só funciona junto com "each".' });
        if (s.each && s.external && !s.onceBy) issues.push({ level: 'warn', step: at, message: 'Envio por item sem "onceBy": rodar de novo pode repetir o envio.' });
        break;
      case 'browser': {
        if (!/^https?:\/\//.test((s.url ?? '').replace(/\{\{[^}]+\}\}/g, 'x'))) issues.push({ level: 'error', step: at, message: 'URL inválida.' });
        if (!Array.isArray(s.actions)) issues.push({ level: 'error', step: at, message: 'O passo browser precisa de "actions" (uma lista, pode ser vazia).' });
        for (const a of s.actions ?? []) {
          if (!BROWSER_DO.includes(a.do)) issues.push({ level: 'error', step: at, message: `Ação de navegador desconhecida: ${String(a.do)}.` });
          else if ((a.do === 'click' || a.do === 'fill' || a.do === 'list') && !a.target?.trim()) issues.push({ level: 'error', step: at, message: `A ação "${a.do}" precisa de "target".` });
          else if ((a.do === 'read' || a.do === 'list' || a.do === 'screenshot') && !/^[a-z][a-z0-9_]*$/.test(a.as ?? '')) issues.push({ level: 'error', step: at, message: `A ação "${a.do}" precisa de "as" (nome minúsculo, sem espaço).` });
        }
        break;
      }
      case 'research':
        if (!s.query?.trim()) issues.push({ level: 'error', step: at, message: 'A pesquisa precisa de "query" (o que buscar).' });
        if (s.sources !== undefined && !(s.sources >= 1 && s.sources <= 5)) issues.push({ level: 'error', step: at, message: '"sources" vai de 1 a 5.' });
        if (s.sites !== undefined && !Array.isArray(s.sites)) issues.push({ level: 'error', step: at, message: '"sites" é uma lista de endereços.' });
        break;
      case 'mcp':
        if (!env.mcpServers.includes(s.server)) issues.push({ level: 'warn', step: at, message: `Servidor MCP "${s.server}" ainda não foi adicionado (add_mcp_server).` });
        break;
      case 'decide':
        if (!ACTIVITY_NAME.test(s.activity ?? '')) issues.push({ level: 'error', step: at, message: 'A decisão precisa de "activity": o nome da atividade, minúsculo e sem espaço (ex.: triagem_email).' });
        if (!s.question?.trim()) issues.push({ level: 'error', step: at, message: 'A decisão precisa de "question".' });
        if (!s.state?.trim()) issues.push({ level: 'error', step: at, message: 'A decisão precisa de "state" (o que está sendo decidido).' });
        if (typeof s.options === 'string' ? !s.options.includes('{{') : Object.keys(s.options ?? {}).length < 2) issues.push({ level: 'error', step: at, message: 'A decisão precisa de pelo menos duas "options" (ou um template que vire a lista).' });
        break;
      case 'branch': {
        const target = s.then === 'end' ? null : s.then.replace(/^goto:/, '');
        if (s.then !== 'end' && !s.then.startsWith('goto:')) issues.push({ level: 'error', step: at, message: 'O "then" do branch é "end" ou "goto:<chave>".' });
        if (target && !p.steps.some((x) => x.key === target)) issues.push({ level: 'error', step: at, message: `O passo "${target}" não existe.` });
        break;
      }
      case 'handoff':
        if (!env.pipos.includes(s.to.replace(/^@/, ''))) issues.push({ level: 'warn', step: at, message: `Ainda não existe o Pipo @${s.to}.` });
        break;
      default:
        break;
    }
  });
  // Ação externa sem um "confirmar" antes: o executor vai pedir permissão na hora (aviso).
  let confirmed = false;
  for (const s of p.steps) {
    if (s.kind === 'confirm') confirmed = true;
    if (s.external && !confirmed) issues.push({ level: 'warn', step: s.key, message: `"${s.title}" sai da máquina sem um passo de confirmação antes; vou pedir permissão na hora.` });
  }
  const mk = new Set<string>();
  for (const m of p.metrics) {
    if (mk.has(m.key)) issues.push({ level: 'error', message: `Métrica repetida: ${m.key}.` });
    mk.add(m.key);
    for (const ref of references(m.from)) {
      const mm = /^passos\.([a-z0-9_]+)/.exec(ref);
      if (mm && !keys.has(mm[1])) issues.push({ level: 'error', message: `A métrica ${m.key} usa o passo "${mm[1]}", que não existe.` });
    }
  }
  return issues;
}

const KIND_LABEL: Record<StepKind, string> = {
  script: 'script',
  http: 'chamada de API',
  browser: 'navegador',
  research: 'pesquisa',
  mcp: 'ferramenta MCP',
  sheet: 'planilha',
  agent: 'IA',
  decide: 'decisão',
  confirm: 'confirmação',
  branch: 'condição',
  notify: 'aviso',
  handoff: 'entrega para outro Pipo',
};

function detailOf(s: PipoStep): string {
  switch (s.kind) {
    case 'script':
      return `${s.command} ${s.args.join(' ')}`;
    case 'http':
      return `${s.method} ${s.url.replace(/\{\{segredo\.[^}]+\}\}/g, '••••')}${s.each ? ` · um por item${s.onceBy ? ', sem repetir' : ''}` : ''}`;
    case 'browser':
      return `${s.url}${s.actions?.length ? ` · ${s.actions.length} ${s.actions.length === 1 ? 'ação' : 'ações'}` : ''}`;
    case 'research':
      return `"${s.query}" · ${s.sources ?? 3} fontes${s.sites?.length ? ` em ${s.sites.join(', ')}` : ''}`;
    case 'mcp':
      return `${s.server} → ${s.tool}`;
    case 'sheet':
      return `${s.action === 'read' ? 'ler' : s.action === 'append' ? 'adicionar linhas em' : 'atualizar'} ${s.range}`;
    case 'agent':
      return `${s.model ?? 'modelo do Pipo'}${s.json ? ' · JSON' : ''}${s.askPipo ? ` · pergunta a @${s.askPipo}` : ''}`;
    case 'decide':
      return `${s.question} · ${typeof s.options === 'string' ? 'opções da lista' : Object.keys(s.options ?? {}).join(' | ')}`;
    case 'confirm':
      return s.message;
    case 'branch':
      return `se ${s.if} → ${s.then === 'end' ? 'encerra' : s.then.replace('goto:', 'vai para ')}`;
    case 'notify':
      return s.title;
    case 'handoff':
      return `para @${s.to}${s.run ? ' (dispara)' : ''}`;
  }
}

/** Passos numerados para o card do plano. */
export function describePlaybook(p: PipoPlaybook): Array<{ title: string; detail: string }> {
  return p.steps.map((s, i) => ({ title: `${i + 1}. ${s.title}${s.external ? ' ⚠︎' : ''}`, detail: `${KIND_LABEL[s.kind]} · ${detailOf(s)}` }));
}
