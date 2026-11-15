// O que o Pipo estuda para se aprimorar: como foi a execução de referência, o que o usuário fez com ela
// (aprovou, pulou, recusou, regras que ensinou) e o histórico recente. Tudo vira texto para o modelo.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describePlaybook } from '@shared/plan-check';
import type { Pipo, PipoPlaybook, PipoRun } from '@shared/pipos';
import { db } from '../../db';
import { readMcpConfig } from '../mcp-client';
import { activePlaybook, listMemory, listPipos, listRuns, listVersions, pipoDir, runSteps } from '../repo';
import { secretNames } from '../secrets';
import { lessonsText, listImprovements } from './store';

/** Resultado de um ensaio (modo seco) de uma versão candidata. */
export interface Rehearsal {
  status: string;
  error: string | null;
  steps: Array<{ key: string; title: string; status: string; preview: string | null; error: string | null }>;
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

export const runDirOf = (pipo: Pipo, runId: number): string => join(pipoDir(pipo.slug), 'runs', String(runId));

/** A entrada que a execução recebeu (para ensaiar as candidatas com os mesmos dados). */
export function runInput(pipo: Pipo, runId: number): unknown {
  return readJson(join(runDirOf(pipo, runId), '_entrada.json'));
}

/** Quantos itens o usuário pulou nas confirmações em lote da execução. */
export function skippedIn(pipo: Pipo, runId: number): number {
  const dir = runDirOf(pipo, runId);
  return runSteps(runId)
    .filter((s) => s.kind === 'confirm')
    .reduce((n, s) => n + Number((readJson(join(dir, `${s.key}.json`)) as { pulados?: number } | null)?.pulados ?? 0), 0);
}

/** Sinais para decidir se vale estudar agora (ver shouldImprove). */
export function improveSignals(pipo: Pipo, run: PipoRun): { lastStatus: PipoRun['status']; refused: boolean; skipped: number; newRules: number; runsSinceAttempt: number; hoursSinceAttempt: number | null; pending: boolean } {
  const last = listImprovements(pipo.id, 1)[0] ?? null;
  const since = last?.createdAt ?? '1970-01-01T00:00:00.000Z';
  const versionAt = activePlaybook(pipo.id)?.createdAt ?? since;
  const runs = db().get<{ n: number }>('SELECT COUNT(*) AS n FROM pipo_runs WHERE pipo_id = ? AND dry_run = 0 AND started_at > ?', pipo.id, since)?.n ?? 0;
  return {
    lastStatus: run.status,
    refused: run.status === 'cancelled' && /recusou|pulou todos/i.test(run.error ?? ''),
    skipped: skippedIn(pipo, run.id),
    newRules: listMemory(pipo.id).filter((r) => r.createdAt > versionAt).length,
    runsSinceAttempt: runs,
    hoursSinceAttempt: last ? (Date.now() - Date.parse(last.createdAt)) / 3_600_000 : null,
    pending: !!last && (last.status === 'pending' || last.status === 'working'),
  };
}

const STATUS: Record<string, string> = { done: 'ok', failed: 'FALHOU', skipped: 'pulado', running: 'rodando', waiting: 'esperando', pending: 'não rodou', cancelled: 'cancelado' };

/** A execução de referência, passo a passo, com as saídas (cortadas) e o que o usuário fez. */
export function runText(pipo: Pipo, run: PipoRun): string {
  const dir = runDirOf(pipo, run.id);
  const steps = runSteps(run.id);
  const input = runInput(pipo, run.id);
  const lines = steps.map((s, i) => {
    const out = s.status === 'done' ? readJson(join(dir, `${s.key}.json`)) : null;
    const shown = out !== null ? cut(JSON.stringify(out), 1500) : (s.preview ?? '');
    return `${i + 1}. [${STATUS[s.status] ?? s.status}] ${s.key} (${s.kind}) "${s.title}"${s.error ? ` — erro: ${cut(s.error, 400)}` : ''}${shown ? `\n   saída: ${shown}` : ''}`;
  });
  const skipped = skippedIn(pipo, run.id);
  return [
    `## Execução de referência #${run.id} (${run.trigger}, ${run.startedAt}): ${run.status === 'done' ? 'terminou bem' : run.status === 'failed' ? `FALHOU — ${run.error}` : `${run.status} — ${run.error ?? ''}`}`,
    input !== null ? `Entrada: ${cut(JSON.stringify(input), 1500)}` : 'Entrada: nenhuma.',
    'Passos:',
    ...lines,
    skipped ? `Nas confirmações, o usuário pulou ${skipped} ${skipped === 1 ? 'item' : 'itens'} (não quis que saíssem).` : null,
    Object.keys(run.metrics).length ? `Métricas: ${Object.entries(run.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Um ensaio de uma versão (atual ou candidata), passo a passo. */
export function rehearsalText(label: string, r: Rehearsal): string {
  return [`## Ensaio — ${label}: ${r.status === 'done' ? 'passou' : `${r.status}${r.error ? ` — ${r.error}` : ''}`}`, ...r.steps.map((s, i) => `${i + 1}. [${STATUS[s.status] ?? s.status}] ${s.key} "${s.title}"${s.error ? ` — erro: ${cut(s.error, 300)}` : ''}${s.preview ? `\n   saída: ${cut(s.preview, 600)}` : ''}`)].join('\n');
}

/** Quem é o Pipo, o que o usuário ensinou, o histórico e o que ele pode usar. */
export function pipoText(pipo: Pipo, playbook: PipoPlaybook): string {
  const p = pipo.personality;
  const runs = listRuns(pipo.id, 8).filter((r) => !r.dryRun);
  const versions = listVersions(pipo.id).slice(-3);
  const dir = pipoDir(pipo.slug);
  let scripts: string[] = [];
  try {
    scripts = readdirSync(join(dir, 'scripts'));
  } catch {
    scripts = [];
  }
  const lessons = lessonsText(12);
  return [
    `# Pipo ${pipo.name} (@${pipo.slug})`,
    `Missão: ${p.mission || '—'}. Tom: ${p.tone || '—'}. Nunca: ${p.never.join('; ') || '—'}.`,
    `Regras que o usuário ensinou: ${listMemory(pipo.id).map((r) => r.rule).join(' | ') || 'nenhuma'}.`,
    `Últimas execuções reais: ${runs.map((r) => `#${r.id} ${r.status}${r.error ? ` (${cut(r.error, 120)})` : ''}${Object.keys(r.metrics).length ? ` [${Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}]` : ''}`).join(' | ') || 'nenhuma'}.`,
    `Versões: ${versions.map((v) => `v${v.version}: ${v.changelog}`).join(' | ') || '—'}.`,
    `O que ele pode usar: scripts [${scripts.join(', ') || 'nenhum'}]; segredos [${secretNames(pipo.slug).join(', ') || 'nenhum'}]; servidores MCP [${Object.keys(readMcpConfig(dir)).join(', ') || 'nenhum'}]; outros Pipos [${listPipos().filter((x) => x.id !== pipo.id).map((x) => x.slug).join(', ') || 'nenhum'}].`,
    '## Plano atual (resumo)',
    ...describePlaybook(playbook).map((s) => `${s.title} — ${s.detail}`),
    '## Plano atual (JSON)',
    JSON.stringify(playbook),
    lessons ? `## Lições que os Pipos já aprenderam (use quando a situação bater)\n${lessons}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
