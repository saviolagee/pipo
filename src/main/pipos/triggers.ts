// Gatilhos dos Pipos (Fase 19): agenda em linguagem natural (cron local), recuperação de execuções
// perdidas com o PC desligado, folgas/férias, janela de horário e "depois de outro Pipo".
import { nextRuns, parseSchedule, runsBetween } from '@shared/schedule';
import type { AfterPipoSpec, Pipo, PipoTrigger, ScheduleSpec } from '@shared/pipos';
import { PIPO_COLORS } from '@shared/pipos';
import { showCard } from '../cards';
import { db } from '../db';
import { isAbsent } from '../db/repos/days';
import { getKV, setKV } from '../db/repos/settings';
import { every } from '../scheduler';
import { dayKey, hmToMin, minutesOfDay } from '../time';
import { builderHooks } from './builder-tools';
import { flushHeldReports, startRun } from './deps';
import { pipesChanged, pipoHooks } from './ipc';
import { activePlaybook, addTrigger, deleteTrigger, getPipo, listTriggers, markTriggerFired } from './repo';
import { isRunning } from './runner';

export interface TriggerDeps {
  now: () => Date;
  run: (pipoId: number, trigger: string) => Promise<unknown>;
  askMissed: (pipo: Pipo, at: Date) => Promise<boolean>;
}

/** Pode rodar agora? (pausado, folga, janela de horário, já rodando) */
export function blockedReason(p: Pipo, now: Date): string | null {
  if (p.paused) return 'pausado';
  if (!p.activeVersion) return 'sem plano contratado';
  if (!p.runOnDaysOff && isAbsent(dayKey(now))) return 'dia de folga';
  const w = activePlaybook(p.id)?.playbook.limits.window;
  if (w) {
    const m = minutesOfDay(now);
    if (m < hmToMin(w.start) || m >= hmToMin(w.end)) return 'fora da janela de horário';
  }
  if (isRunning(p.id)) return 'já está rodando';
  return null;
}

/**
 * Um ciclo do motor: dispara as agendas que venceram desde a última verificação.
 * Execuções que venceram com o app fechado (mais de 2 min atrás) viram uma pergunta.
 */
export async function tickTriggers(deps: TriggerDeps, sinceIso: string): Promise<number> {
  const now = deps.now();
  let fired = 0;
  for (const t of listTriggers()) {
    if (t.kind !== 'schedule' || !t.enabled) continue;
    const spec = t.spec as ScheduleSpec;
    if (!spec.cron) continue;
    const p = getPipo(t.pipoId);
    if (!p) continue;
    const from = new Date(Math.max(Date.parse(t.lastFiredAt ?? sinceIso), now.getTime() - 24 * 3_600_000));
    const due = runsBetween(spec.cron, from, now);
    if (!due.length) continue;
    const latest = due[due.length - 1];
    markTriggerFired(t.id, now);
    const reason = blockedReason(p, now);
    if (reason) continue;
    const missed = now.getTime() - latest.getTime() > 2 * 60_000;
    if (missed && !(await deps.askMissed(p, latest))) continue;
    await deps.run(p.id, missed ? 'schedule:recuperada' : 'schedule');
    fired++;
  }
  return fired;
}

async function askMissed(p: Pipo, at: Date): Promise<boolean> {
  const hh = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const answer = await showCard(
    {
      kind: 'info',
      glow: 'attention',
      mascot: 'looking',
      pipoColor: PIPO_COLORS[p.color],
      label: `${p.name} · execução perdida`,
      title: `Rodar a das ${hh} que perdeu?`,
      body: 'O computador estava desligado (ou o Pipo fechado) no horário.',
      buttons: [
        { id: 'no', label: 'Pular', kbd: 'N', variant: 'secondary' },
        { id: 'yes', label: 'Rodar agora', kbd: 'Y', variant: 'primary' },
      ],
    },
    { timeoutMs: 15 * 60_000, timeoutValue: 'no' },
  );
  return answer === 'yes';
}

/** Converte os gatilhos do rascunho em gatilhos reais ao contratar (substitui os anteriores). */
export function applyDraftTriggers(pipoId: number, t: { schedule: string | null; after: { from: string; delayMin: number } | null; events: unknown[] }): string[] {
  const out: string[] = [];
  for (const old of listTriggers(pipoId)) deleteTrigger(old.id);
  db().run('DELETE FROM pipo_links WHERE to_pipo_id = ? AND kind = ?', pipoId, 'after');
  if (t.schedule) {
    const parsed = parseSchedule(t.schedule);
    if (parsed) {
      addTrigger(pipoId, 'schedule', { text: t.schedule, cron: parsed.cron } satisfies ScheduleSpec);
      const next = nextRuns(parsed.cron, new Date(), 1)[0];
      out.push(`${parsed.label}${next ? ` (próxima: ${next.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}`);
    } else out.push(`não entendi a agenda "${t.schedule}" — ele roda só quando você pedir`);
  }
  if (t.after) {
    const from = getPipo(t.after.from);
    if (from) {
      addTrigger(pipoId, 'after_pipo', { from: from.slug, delayMin: t.after.delayMin } satisfies AfterPipoSpec);
      db().run('INSERT OR REPLACE INTO pipo_links (from_pipo_id, to_pipo_id, kind, delay_min, enabled) VALUES (?, ?, ?, ?, 1)', from.id, pipoId, 'after', Math.max(0, Math.round(t.after.delayMin)));
      out.push(`depois de @${from.slug}${t.after.delayMin ? ` (+${t.after.delayMin} min)` : ''}`);
    }
  }
  for (const e of t.events) {
    addTrigger(pipoId, 'event', e as PipoTrigger['spec']);
    out.push(`evento: ${JSON.stringify(e)}`);
  }
  out.push('e quando você pedir (botão, @nome ou /rodar)');
  return out;
}

export function nextRunAt(pipoId: number): string | null {
  const p = getPipo(pipoId);
  if (!p || p.paused || !p.activeVersion) return null;
  let best: Date | null = null;
  for (const t of listTriggers(pipoId)) {
    if (t.kind !== 'schedule' || !t.enabled) continue;
    const n = nextRuns((t.spec as ScheduleSpec).cron, new Date(), 1)[0];
    if (n && (!best || n < best)) best = n;
  }
  return best?.toISOString() ?? null;
}

export function scheduleLabel(pipoId: number): string | null {
  const t = listTriggers(pipoId).find((x) => x.kind === 'schedule' && x.enabled);
  return t ? (parseSchedule((t.spec as ScheduleSpec).text)?.label ?? (t.spec as ScheduleSpec).text) : null;
}

export function registerTriggers(): void {
  builderHooks.applyTriggers = applyDraftTriggers;
  pipoHooks.nextRunAt = nextRunAt;
  // Última verificação persistida: na abertura, o que venceu com o app fechado vira pergunta.
  const since = getKV<string | null>('pipos:triggersCheckedAt', null) ?? new Date().toISOString();
  const deps: TriggerDeps = {
    now: () => new Date(),
    run: (pipoId, trigger) => startRun(pipoId, { trigger }).catch((e) => console.warn('[gatilhos] não rodou:', e)),
    askMissed,
  };
  let checkedAt = since;
  every('pipoTriggers', 30_000, async () => {
    // Espera a entrada do app antes de perguntar sobre execuções perdidas.
    if (process.uptime() < 30) return;
    const now = new Date().toISOString();
    const fired = await tickTriggers(deps, checkedAt);
    checkedAt = now;
    setKV('pipos:triggersCheckedAt', now);
    if (fired) pipesChanged();
  });
  // Relatórios de execuções agendadas que esperaram o foco acabar.
  every('pipoHeldReports', 15_000, () => flushHeldReports());
  // A "próxima execução" dos cartões da Equipe muda com o tempo.
  every('pipoNextRun', 5 * 60_000, () => pipesChanged());
}
