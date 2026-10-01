// Validação e descrição do plano de execução (usado pelo construtor e pelo card do plano).
import type { PipoPlaybook, PipoStep, StepKind } from './pipos';
import { references } from './template';

export interface PlanIssue {
  level: 'error' | 'warn';
  step?: string;
  message: string;
}

const KINDS: StepKind[] = ['script', 'http', 'mcp', 'sheet', 'agent', 'confirm', 'branch', 'notify', 'handoff'];
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Marca como externa toda ação que sai da máquina, mesmo que o plano tenha esquecido. */
export function normalizePlaybook(p: PipoPlaybook): PipoPlaybook {
  return {
    ...p,
    steps: p.steps.map((s) => {
      if (s.kind === 'http' && s.method !== 'GET') return { ...s, external: true };
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
    case 'mcp':
      return [s.args];
    case 'sheet':
      return [s.spreadsheetId, s.range, s.rows ?? ''];
    case 'agent':
      return [s.prompt];
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
          if (!['script', 'http', 'mcp'].includes(s.kind)) issues.push({ level: 'error', step: at, message: 'Segredos só podem ser usados em passos script, http e mcp.' });
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
      case 'mcp':
        if (!env.mcpServers.includes(s.server)) issues.push({ level: 'warn', step: at, message: `Servidor MCP "${s.server}" ainda não foi adicionado (add_mcp_server).` });
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
  mcp: 'ferramenta MCP',
  sheet: 'planilha',
  agent: 'IA',
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
    case 'mcp':
      return `${s.server} → ${s.tool}`;
    case 'sheet':
      return `${s.action === 'read' ? 'ler' : s.action === 'append' ? 'adicionar linhas em' : 'atualizar'} ${s.range}`;
    case 'agent':
      return `${s.model ?? 'modelo do Pipo'}${s.json ? ' · JSON' : ''}${s.askPipo ? ` · pergunta a @${s.askPipo}` : ''}`;
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
