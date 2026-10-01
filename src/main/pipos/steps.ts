// Execução de cada tipo de passo determinístico (script, http, mcp, sheet). O agente, as confirmações
// e os avisos ficam no runner, que injeta as dependências (testável sem Electron).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { HttpStep, McpStep, ScriptStep, SheetStep } from '@shared/pipos';
import { render, renderJson, renderText, type TemplateCtx } from '@shared/template';
import { augmentedPath } from '../agent/claude-bin';
import { callMcpTool, readMcpConfig } from './mcp-client';

export class StepError extends Error {}

const INTERPRETERS: Record<string, string[]> = {
  node: ['node'],
  python: ['python', 'python3'],
  python3: ['python3', 'python'],
  powershell: ['powershell', 'pwsh'],
  pwsh: ['pwsh', 'powershell'],
  bash: ['bash'],
  sh: ['sh'],
};

function which(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of augmentedPath().split(process.platform === 'win32' ? ';' : ':')) {
    for (const e of exts) {
      const p = join(dir, name + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Interpretador permitido → executável. Sem Node instalado, usa o Node embutido no app. */
export function resolveInterpreter(command: string): { bin: string; env: Record<string, string> } {
  const names = INTERPRETERS[command.toLowerCase()];
  if (!names) throw new StepError(`Interpretador não permitido: ${command}. Use node, python, powershell ou bash.`);
  for (const n of names) {
    const p = which(n);
    if (p) return { bin: p, env: {} };
  }
  if (command.toLowerCase() === 'node') return { bin: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  throw new StepError(`${command} não está instalado neste computador.`);
}

/** O script tem que estar dentro de scripts/ do Pipo (nada de ../ ou caminhos absolutos fora dele). */
export function scriptPath(pipoDir: string, file: string): string {
  const scripts = join(pipoDir, 'scripts');
  const full = isAbsolute(file) ? resolve(file) : resolve(pipoDir, file);
  const rel = relative(scripts, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new StepError(`O script precisa estar em scripts/ do Pipo (recebi ${file}).`);
  if (!existsSync(full)) throw new StepError(`Script não encontrado: ${relative(pipoDir, full)}`);
  return full;
}

/** Saída do script: JSON (inteiro ou última linha) ou texto. */
export function parseOutput(stdout: string): unknown {
  const t = stdout.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const last = t.split('\n').pop() ?? '';
    try {
      return JSON.parse(last);
    } catch {
      return t;
    }
  }
}

export interface StepEnv {
  pipoDir: string;
  runDir: string;
  ctx: TemplateCtx;
  secrets: Record<string, string>;
  dryRun: boolean;
  signal: AbortSignal;
  input: unknown;
}

export async function runScript(step: ScriptStep, e: StepEnv): Promise<unknown> {
  const { bin, env: interpEnv } = resolveInterpreter(step.command);
  const args = step.args.map((a) => renderText(a, e.ctx));
  if (!args.length) throw new StepError('Diga qual arquivo de scripts/ rodar.');
  args[0] = scriptPath(e.pipoDir, args[0]);
  const ps = /powershell|pwsh/i.test(step.command);
  const finalArgs = ps ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args] : args;
  const inputFile = join(e.runDir, 'entrada.json');
  writeFileSync(inputFile, JSON.stringify(e.input ?? null));
  const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, renderText(v, e.ctx, { allowSecrets: true })]));
  const env: NodeJS.ProcessEnv = {
    PATH: augmentedPath(),
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    // Segredos do Pipo como variáveis de ambiente, só neste processo.
    ...e.secrets,
    ...stepEnv,
    ...interpEnv,
    PIPO_DRY_RUN: e.dryRun ? '1' : '0',
    PIPO_INPUT: inputFile,
    PIPO_RUN_DIR: e.runDir,
    PIPO_CONTEXT: JSON.stringify({ passos: e.ctx.passos, entrada: e.ctx.entrada }),
  };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, finalArgs, { cwd: e.pipoDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.length > 20_000_000) child.kill();
    });
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new StepError(`Passou do tempo limite (${step.timeoutSec ?? 300}s).`));
    }, (step.timeoutSec ?? 300) * 1000);
    const onAbort = (): void => {
      child.kill();
      reject(new StepError('Cancelado.'));
    };
    e.signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (x) => {
      clearTimeout(timer);
      reject(new StepError(`Não consegui rodar ${step.command}: ${x.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      e.signal.removeEventListener('abort', onAbort);
      if (code === 0) resolvePromise(parseOutput(out));
      else reject(new StepError(`O script terminou com erro (código ${code}). ${err.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

const MAX_EACH = 500;

export async function runHttp(step: HttpStep, e: StepEnv, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (step.each) return runHttpEach(step, e, fetchImpl);
  return httpOnce(step, e.ctx, e, fetchImpl);
}

/** Uma requisição com o contexto dado (o `each` passa {{item}} e {{indice}}). */
async function httpOnce(step: HttpStep, ctx: TemplateCtx, e: StepEnv, fetchImpl: typeof fetch): Promise<unknown> {
  const url = renderText(step.url, ctx, { allowSecrets: true });
  const headers = Object.fromEntries(Object.entries(step.headers ?? {}).map(([k, v]) => [k, renderText(v, ctx, { allowSecrets: true })]));
  let body: string | undefined;
  if (step.body?.trim()) {
    const b = renderJson(step.body, ctx, { allowSecrets: true });
    body = typeof b === 'string' ? b : JSON.stringify(b);
    if (typeof b !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  // Modo seco: GET de leitura roda; o resto só mostra o que seria enviado.
  if (e.dryRun && (step.method !== 'GET' || step.external)) {
    return { seco: true, requisicao: { metodo: step.method, url, corpo: body ? safeParse(body) : null } };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), (step.timeoutSec ?? 60) * 1000);
  const onAbort = (): void => ac.abort();
  e.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { method: step.method, headers, body, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new StepError(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return (res.headers.get('content-type') ?? '').includes('json') ? safeParse(text) : text;
  } catch (x) {
    if (x instanceof StepError) throw x;
    throw new StepError(ac.signal.aborted ? (e.signal.aborted ? 'Cancelado.' : 'Passou do tempo limite.') : `Falha de rede: ${(x as Error).message}`);
  } finally {
    clearTimeout(timer);
    e.signal.removeEventListener('abort', onAbort);
  }
}

/** Itens já enviados por este passo (fica em state/ do Pipo; não vai junto no .pipo). */
function onceFile(pipoDir: string, key: string): string {
  return join(pipoDir, 'state', `once-${key.replace(/[^\w-]/g, '_')}.json`);
}

export function readOnce(pipoDir: string, stepKey: string): Set<string> {
  const f = onceFile(pipoDir, stepKey);
  try {
    return new Set(JSON.parse(readFileSync(f, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveOnce(e: StepEnv, stepKey: string, done: Set<string>): void {
  const f = onceFile(e.pipoDir, stepKey);
  mkdirSync(join(e.pipoDir, 'state'), { recursive: true });
  writeFileSync(f, JSON.stringify([...done]));
}

/** Uma requisição por item da lista; com `onceBy`, quem já recebeu nunca recebe de novo. */
async function runHttpEach(step: HttpStep, e: StepEnv, fetchImpl: typeof fetch): Promise<unknown> {
  const list = render(step.each as string, e.ctx);
  if (!Array.isArray(list)) throw new StepError(`"each" não é uma lista (${step.each}).`);
  if (list.length > MAX_EACH) throw new StepError(`A lista tem ${list.length} itens; o máximo por execução é ${MAX_EACH}.`);
  const done = step.onceBy ? readOnce(e.pipoDir, step.key) : new Set<string>();
  const resultados: Array<{ indice: number; chave?: string; ok: boolean; pulado?: boolean; resposta?: unknown; erro?: string }> = [];
  let enviados = 0;
  let pulados = 0;
  let falhas = 0;
  for (let i = 0; i < list.length; i++) {
    if (e.signal.aborted) throw new StepError('Cancelado.');
    const ctx: TemplateCtx = { ...e.ctx, item: list[i], indice: i };
    const chave = step.onceBy ? renderText(step.onceBy, ctx).trim() : undefined;
    if (chave && done.has(chave)) {
      pulados++;
      resultados.push({ indice: i, chave, ok: true, pulado: true });
      continue;
    }
    try {
      const resposta = await httpOnce(step, ctx, e, fetchImpl);
      enviados++;
      resultados.push({ indice: i, chave, ok: true, resposta });
      // Grava a cada envio: se cair no meio, rodar de novo não repete quem já recebeu.
      if (chave && !e.dryRun) {
        done.add(chave);
        saveOnce(e, step.key, done);
      }
    } catch (x) {
      falhas++;
      const erro = (x as Error).message;
      resultados.push({ indice: i, chave, ok: false, erro });
      if (step.onError !== 'continue') throw new StepError(`Falhou no item ${i + 1} de ${list.length}${chave ? ` (${chave})` : ''}: ${erro}. ${enviados} já ${enviados === 1 ? 'foi' : 'foram'}.`);
    }
  }
  return { enviados, pulados, falhas, resultados };
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export async function runMcp(step: McpStep, e: StepEnv): Promise<unknown> {
  const servers = readMcpConfig(e.pipoDir);
  const cfg = servers[step.server];
  if (!cfg) throw new StepError(`Servidor MCP "${step.server}" não está no mcp.json do Pipo.`);
  const args = (renderJson(step.args || '{}', e.ctx, { allowSecrets: true }) ?? {}) as Record<string, unknown>;
  if (e.dryRun && step.external) return { seco: true, chamada: { servidor: step.server, ferramenta: step.tool, argumentos: args } };
  const env = Object.fromEntries(Object.entries(cfg.env ?? {}).map(([k, v]) => [k, renderText(v, e.ctx, { allowSecrets: true })]));
  const r = await callMcpTool(cfg, step.tool, args, { cwd: e.pipoDir, env: { ...e.secrets, ...env }, timeoutMs: 120_000, signal: e.signal });
  if (r.isError) throw new StepError(`A ferramenta ${step.tool} deu erro: ${r.text.slice(0, 300)}`);
  return r.json ?? r.text;
}

/** Google Sheets pelo login Google da V1 (escopo spreadsheets). */
export async function runSheet(step: SheetStep, e: StepEnv, gfetch: <T>(url: string, init?: RequestInit) => Promise<T>): Promise<unknown> {
  const id = encodeURIComponent(renderText(step.spreadsheetId, e.ctx));
  const range = renderText(step.range, e.ctx);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`;
  const read = async (): Promise<{ header: string[]; rows: Array<Record<string, string>>; values: string[][] }> => {
    const r = await gfetch<{ values?: string[][] }>(base);
    const values = r.values ?? [];
    const header = values[0] ?? [];
    return { header, values, rows: values.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))) };
  };
  if (step.action === 'read') return (await read()).rows;

  const raw = step.rows ? renderJson(step.rows, e.ctx) : [];
  const list = Array.isArray(raw) ? raw : [raw];
  if (e.dryRun) return { seco: true, acao: step.action, intervalo: range, linhas: list.slice(0, 5), total: list.length };
  const { header, values } = await read();
  const toRow = (item: unknown): string[] => (Array.isArray(item) ? item.map(String) : header.map((h) => String((item as Record<string, unknown>)?.[h] ?? '')));

  if (step.action === 'append') {
    await gfetch(`${base}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: list.map(toRow) }) });
    return { adicionadas: list.length };
  }
  // update: acha a linha pela coluna-chave e reescreve as colunas informadas.
  const keyCol = step.keyColumn ?? header[0];
  const ki = header.indexOf(keyCol);
  if (ki < 0) throw new StepError(`Coluna-chave "${keyCol}" não existe na planilha.`);
  const sheetName = range.includes('!') ? range.split('!')[0] : '';
  let updated = 0;
  let appended = 0;
  const data: Array<{ range: string; values: string[][] }> = [];
  const toAppend: string[][] = [];
  for (const item of list) {
    const row = toRow(item);
    const idx = values.findIndex((v, i) => i > 0 && v[ki] === row[ki]);
    if (idx > 0) {
      const merged = header.map((h, i) => (row[i] !== '' ? row[i] : (values[idx][i] ?? '')));
      data.push({ range: `${sheetName ? `${sheetName}!` : ''}A${idx + 1}`, values: [merged] });
      updated++;
    } else {
      toAppend.push(row);
      appended++;
    }
  }
  if (data.length) await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (toAppend.length) await gfetch(`${base}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: toAppend }) });
  return { atualizadas: updated, adicionadas: appended };
}
