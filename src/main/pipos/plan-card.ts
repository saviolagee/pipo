// Card do plano no chat do construtor, com o botão "Contratar": quando o plano já passou no ensaio,
// um clique vira a versão fixa, sem mais uma volta na conversa.
import { describePlaybook } from '@shared/plan-check';
import { PIPO_COLORS, type PipoPlaybook } from '@shared/pipos';
import { emit } from '../bus';
import { dismissCard, showCard } from '../cards';
import { addMessage } from '../db/repos/conversations';
import { builderHooks, checkPlan, emitDraft, pipoOf } from './builder-tools';
import { closeDraft, draftForConversation, getDraft, updateDraft, type Draft } from './drafts';
import { pipesChanged } from './ipc';
import { setLive } from './live';
import { activePlaybook, addVersion } from './repo';

let planCardId: string | null = null;

export function dismissPlanCard(value: string): void {
  if (planCardId) dismissCard(planCardId, value);
  planCardId = null;
}

/** O que ainda falta para contratar, ou null quando está pronto. */
export function hireBlocker(d: Draft): string | null {
  const errors = checkPlan(d, d.data.plan).filter((i) => i.level === 'error');
  if (errors.length) return `o plano tem ${errors.length === 1 ? 'um problema' : `${errors.length} problemas`}: ${errors.map((e) => `${e.step ? `${e.step}: ` : ''}${e.message}`).join(' ')}`;
  if (!d.data.rehearsal?.ok) return 'falta um ensaio que passe';
  return null;
}

export interface HireResult {
  versao: number;
  gatilhos: string[];
  slug: string;
  nome: string;
}

/** O plano ensaiado vira a versão fixa (v1, ou nova versão no /editarpipo) e os gatilhos passam a valer. */
export function hireDraft(d: Draft, o: { changelog?: string; intro?: string } = {}): HireResult {
  const p = pipoOf(d);
  const plan = d.data.plan;
  const prev = d.data.editing ? activePlaybook(p.id) : null;
  const diff = prev ? planDiff(prev.playbook, plan) : null;
  dismissPlanCard('hired');
  const v = addVersion(p.id, plan, o.changelog ?? (d.data.editing ? diff?.join('; ') || 'ajustes' : 'primeira versão'));
  const triggers = builderHooks.applyTriggers(p.id, d.data.triggers);
  updateDraft(d.id, { stage: 'hire' });
  closeDraft(d.id);
  emitDraft({ ...d, stage: 'hire' });
  setLive(p.id, 'done');
  pipesChanged();
  builderHooks.introduce(p.id, o.intro ?? d.data.intro ?? `Oi, sou o ${p.name}. ${p.personality.mission} Me chama com @${p.slug}.`);
  emit('pipos:hired', { pipoId: p.id, version: v.version });
  return { versao: v.version, gatilhos: triggers, slug: p.slug, nome: p.name };
}

/** Clique em "Contratar" no card: contrata e conta no chat do construtor. */
function hireFromCard(draftId: number): void {
  const d = getDraft(draftId);
  const conv = d?.conversationId ?? null;
  // O rascunho já foi contratado ou fechado por outro caminho.
  if (!d || !conv || draftForConversation(conv)?.id !== d.id) return;
  const blocker = hireBlocker(d);
  if (blocker) {
    addMessage(conv, 'assistant', `Ainda não dá para contratar: ${blocker}. Me diz se quer que eu arrume.`);
  } else {
    const r = hireDraft(d);
    // "seg–sex 9h (próxima: …), e quando você pedir (…)"; sozinho, "quando você pedir (…)".
    const when = r.gatilhos.map((g, i) => (i === 0 ? g.replace(/^e /, '').replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase()) : g)).join(', ') || 'quando você pedir';
    addMessage(conv, 'assistant', d.data.editing ? `Pronto, o ${r.nome} agora está na v${r.versao}. Ele roda ${when}.` : `Pronto, o ${r.nome} está contratado. Ele roda ${when}. Para falar com ele, escreva @${r.slug}.`);
  }
  emit('chat:changed', { conversationId: conv });
}

/** Mostra o plano como card no chat (não bloqueia a conversa). */
export function showPlanCard(d: Draft, plan: PipoPlaybook): void {
  const p = pipoOf(d);
  dismissPlanCard('replaced');
  const t = d.data.triggers;
  const when = [t.schedule ? `quando: ${t.schedule}` : null, t.after ? `depois de @${t.after.from}${t.after.delayMin ? ` (+${t.after.delayMin} min)` : ''}` : null, 'ou quando você pedir'].filter(Boolean).join(' · ');
  const issues = checkPlan(d, plan);
  const ready = hireBlocker(d) === null;
  // No card, a linguagem é da pessoa: chaves que faltam numa linha só e sem nomes de ferramentas.
  const missing = [...new Set(issues.flatMap((i) => /^Falta guardar o segredo ([A-Z0-9_]+)/.exec(i.message)?.[1] ?? []))];
  const others = issues.filter((i) => !i.message.startsWith('Falta guardar o segredo'));
  const forPeople = (m: string): string => m.replace(/\s*\((?:use|chame) [a-z_]+[^)]*\)/g, '');
  const id = `plan:${d.id}:${Date.now()}`;
  planCardId = id;
  void showCard({
    id,
    kind: 'pipo_plan',
    glow: 'none',
    mascot: 'happy',
    pipoColor: PIPO_COLORS[p.color],
    label: `plano de execução · ${p.name}`,
    subject: when,
    list: describePlaybook(plan),
    body: [
      plan.metrics.length ? `Conta: ${plan.metrics.map((m) => m.label).join(', ')}` : null,
      `Tempo máximo: ${plan.limits.maxRunMinutes} min${plan.limits.window ? ` · só entre ${plan.limits.window.start} e ${plan.limits.window.end}` : ''}`,
      d.data.rehearsal?.ok ? 'Ensaio: passou (nada saiu da máquina)' : null,
      missing.length
        ? `! ${missing.length === 1 ? `Falta a chave ${missing[0]}` : `Faltam as chaves ${missing.join(', ')}`}. Dá para contratar assim e guardar depois pelo /editarpipo; até lá, os passos que precisam ${missing.length === 1 ? 'dela' : 'delas'} não rodam.`
        : null,
      others.length ? others.map((i) => `${i.level === 'error' ? '✕' : '!'} ${i.step ? `${i.step}: ` : ''}${forPeople(i.message)}`).join('\n') : null,
    ]
      .filter(Boolean)
      .join('\n'),
    // Pronto para contratar: um clique resolve. Ajustes continuam pela conversa.
    buttons: ready
      ? [
          { id: 'ok', label: 'Ajustar conversando', variant: 'secondary' },
          { id: 'hire', label: d.data.editing ? 'Salvar nova versão' : `Contratar ${p.name}`, variant: 'primary' },
        ]
      : [{ id: 'ok', label: 'Ok', variant: 'secondary' }],
  }).then((answer) => {
    if (planCardId === id) planCardId = null;
    if (answer === 'hire') hireFromCard(d.id);
  });
}

/** Resumo legível do que mudou entre duas versões do plano. */
export function planDiff(a: PipoPlaybook, b: PipoPlaybook): string[] {
  const out: string[] = [];
  const ka = new Map(a.steps.map((s) => [s.key, s]));
  const kb = new Map(b.steps.map((s) => [s.key, s]));
  for (const s of b.steps) if (!ka.has(s.key)) out.push(`+ ${s.title}`);
  for (const s of a.steps) if (!kb.has(s.key)) out.push(`− ${s.title}`);
  for (const s of b.steps) {
    const old = ka.get(s.key);
    if (old && JSON.stringify(old) !== JSON.stringify(s)) out.push(`~ ${s.title}`);
  }
  if (a.steps.map((s) => s.key).join() !== b.steps.map((s) => s.key).join() && !out.length) out.push('ordem dos passos');
  if (JSON.stringify(a.metrics) !== JSON.stringify(b.metrics)) out.push('métricas');
  if (JSON.stringify(a.limits) !== JSON.stringify(b.limits)) out.push('limites');
  return out;
}
