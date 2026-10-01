// Conexão entre Pipos (Fase 21): "depois de" com atraso, entrega de dados (handoff) pela caixa de
// entrada, recusa de ciclos e o mapa da equipe.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pipo, PipoRun } from '@shared/pipos';
import { emit } from '../bus';
import { db } from '../db';
import { awayHooks } from '../days/flows';
import { handle } from '../ipc';
import { every } from '../scheduler';
import { inboxHooks, startRun } from './deps';
import { pipesChanged } from './ipc';
import { activePlaybook, getPipo, getRun, listPipos, pipoDir } from './repo';
import { runnerHooks } from './runner';
import { linkHooks } from './builder-tools';
import { blockedReason } from './triggers';

export interface LinkEdge {
  from: number;
  to: number;
  kind: 'after' | 'handoff';
  delayMin: number;
}

/** Todas as conexões: links "depois de" + passos handoff dos planos ativos. */
export function edges(): LinkEdge[] {
  const out: LinkEdge[] = db()
    .all<{ from_pipo_id: number; to_pipo_id: number; delay_min: number }>("SELECT from_pipo_id, to_pipo_id, delay_min FROM pipo_links WHERE kind = 'after' AND enabled = 1")
    .map((r) => ({ from: r.from_pipo_id, to: r.to_pipo_id, kind: 'after' as const, delayMin: r.delay_min }));
  for (const p of listPipos()) {
    for (const s of activePlaybook(p.id)?.playbook.steps ?? []) {
      if (s.kind !== 'handoff') continue;
      const to = getPipo(s.to);
      if (to) out.push({ from: p.id, to: to.id, kind: 'handoff', delayMin: 0 });
    }
  }
  return out;
}

/** Ligar from → to criaria um ciclo (to já chega em from)? */
export function wouldCycle(from: number, to: number, extra: LinkEdge[] = []): boolean {
  if (from === to) return true;
  const all = [...edges(), ...extra];
  const seen = new Set<number>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop() as number;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of all) if (e.from === n) stack.push(e.to);
  }
  return false;
}

export function setAfterLink(fromId: number, toId: number, delayMin: number): void {
  if (wouldCycle(fromId, toId)) {
    const a = getPipo(fromId);
    const b = getPipo(toId);
    throw new Error(`Isso criaria um ciclo: @${b?.slug} já leva até @${a?.slug}. Um Pipo não pode depender de quem depende dele.`);
  }
  db().run('INSERT OR REPLACE INTO pipo_links (from_pipo_id, to_pipo_id, kind, delay_min, enabled) VALUES (?, ?, ?, ?, 1)', fromId, toId, 'after', Math.max(0, Math.round(delayMin)));
  const to = getPipo(toId);
  const from = getPipo(fromId);
  if (to && from) {
    db().run("DELETE FROM pipo_triggers WHERE pipo_id = ? AND kind = 'after_pipo' AND json_extract(spec_json, '$.from') = ?", toId, from.slug);
    db().run("INSERT INTO pipo_triggers (pipo_id, kind, spec_json) VALUES (?, 'after_pipo', ?)", toId, JSON.stringify({ from: from.slug, delayMin }));
  }
  pipesChanged();
}

export function removeLink(fromId: number, toId: number): void {
  const from = getPipo(fromId);
  db().run("DELETE FROM pipo_links WHERE from_pipo_id = ? AND to_pipo_id = ? AND kind = 'after'", fromId, toId);
  if (from) db().run("DELETE FROM pipo_triggers WHERE pipo_id = ? AND kind = 'after_pipo' AND json_extract(spec_json, '$.from') = ?", toId, from.slug);
  pipesChanged();
}

/** Quando uma execução real termina bem, agenda quem vem "depois de" (com o resumo como entrada). */
export function onRunFinished(run: PipoRun): void {
  if (run.dryRun || run.status !== 'done') return;
  const from = getPipo(run.pipoId);
  if (!from) return;
  const links = db().all<{ to_pipo_id: number; delay_min: number }>("SELECT to_pipo_id, delay_min FROM pipo_links WHERE from_pipo_id = ? AND kind = 'after' AND enabled = 1", run.pipoId);
  for (const l of links) {
    const runAfter = new Date(Date.now() + l.delay_min * 60_000).toISOString();
    db().run(
      "INSERT INTO pipo_inbox (to_pipo_id, from_run_id, payload_path, status, run_after, created_at) VALUES (?, ?, '', 'pending', ?, ?)",
      l.to_pipo_id,
      run.id,
      runAfter,
      new Date().toISOString(),
    );
    emit('pipos:handoff', { fromPipoId: run.pipoId, toPipoId: l.to_pipo_id });
  }
  // Sem atraso: já processa (a vaga de execução só abre depois que esta termina).
  if (links.some((l) => l.delay_min === 0)) setTimeout(() => inboxHooks.changed(), 500);
}

interface InboxRow {
  id: number;
  to_pipo_id: number;
  from_run_id: number;
  payload_path: string;
  run_after: string | null;
  created_at: string;
}

/** Processa a caixa de entrada: dispara o Pipo quando chega a hora. Exportado para testes. */
export async function processInbox(now = new Date(), run: (pipo: Pipo, input: unknown, fromRun: PipoRun | null) => Promise<unknown> = defaultRun): Promise<number> {
  const rows = db().all<InboxRow>("SELECT * FROM pipo_inbox WHERE status = 'pending' AND run_after IS NOT NULL AND run_after <= ? ORDER BY id", now.toISOString());
  let n = 0;
  for (const r of rows) {
    const p = getPipo(r.to_pipo_id);
    if (!p) {
      db().run("UPDATE pipo_inbox SET status = 'expired' WHERE id = ?", r.id);
      continue;
    }
    const reason = blockedReason(p, now);
    if (reason) {
      // Pausado/folga: espera até 7 dias; depois desiste.
      if (reason === 'já está rodando' || now.getTime() - Date.parse(r.created_at) < 7 * 86_400_000) continue;
      db().run("UPDATE pipo_inbox SET status = 'expired' WHERE id = ?", r.id);
      continue;
    }
    const fromRun = getRun(r.from_run_id);
    let input: unknown = null;
    if (r.payload_path) {
      try {
        input = JSON.parse(readFileSync(r.payload_path, 'utf8'));
      } catch {
        input = null;
      }
    } else if (fromRun) {
      const slug = getPipo(fromRun.pipoId)?.slug ?? null;
      input = { de: slug, resumo: fromRun.summary, metricas: fromRun.metrics, saidas: slug ? runOutputs(slug, fromRun.id) : {} };
    }
    db().run("UPDATE pipo_inbox SET status = 'consumed' WHERE id = ?", r.id);
    await run(p, input, fromRun);
    n++;
  }
  return n;
}

const MAX_OUTPUTS_BYTES = 1_000_000;

/** Saídas completas (já sem segredos) de uma execução: {{entrada.saidas.<passo>}} no Pipo seguinte. */
export function runOutputs(slug: string, runId: number): Record<string, unknown> {
  const dir = join(pipoDir(slug), 'runs', String(runId));
  const out: Record<string, unknown> = {};
  if (!existsSync(dir)) return out;
  let total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    total += text.length;
    if (total > MAX_OUTPUTS_BYTES) break;
    try {
      out[f.slice(0, -5)] = JSON.parse(text);
    } catch {
      out[f.slice(0, -5)] = text;
    }
  }
  return out;
}

async function defaultRun(p: Pipo, input: unknown, fromRun: PipoRun | null): Promise<unknown> {
  const fromSlug = fromRun ? (getPipo(fromRun.pipoId)?.slug ?? 'pipo') : 'pipo';
  return startRun(p.id, { trigger: `after:${fromSlug}`, input, fromRunId: fromRun?.id ?? null }).catch((e) => console.warn('[conexões]', e));
}

export function registerLinks(): void {
  linkHooks.wouldCycle = (a, b) => wouldCycle(a, b);
  runnerHooks.finished.push(onRunFinished);
  inboxHooks.changed = () => void processInbox().then((n) => n && pipesChanged());
  every('pipoInbox', 15_000, async () => {
    if (await processInbox()) pipesChanged();
  });
  // Card "enquanto você estava fora": o que cada Pipo fez no período.
  awayHooks.push((from, to) => {
    const rows = db().all<{ pipo_id: number; n: number; ok: number }>(
      "SELECT pipo_id, COUNT(*) AS n, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS ok FROM pipo_runs WHERE dry_run = 0 AND started_at >= ? AND started_at < ? GROUP BY pipo_id",
      new Date(`${from}T00:00:00`).toISOString(),
      new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString(),
    );
    if (!rows.length) return null;
    return rows.map((r) => `${getPipo(r.pipo_id)?.name ?? 'Pipo'} rodou ${r.n}× (${r.ok} ok)`).join(' · ');
  });

  handle('pipos:links', () => edges());
  handle('pipos:link', (fromId, toId, delayMin) => setAfterLink(fromId, toId, delayMin));
  handle('pipos:unlink', (fromId, toId) => removeLink(fromId, toId));
  handle('pipos:wouldCycle', (fromId, toId) => wouldCycle(fromId, toId));
}
