// Chat geral da equipe: o usuário fala com todos de uma vez. O Pipo branco modera e responde por
// padrão; os Pipos coloridos respondem com o nome e a cor deles, pegam tarefas e contam aqui quando
// terminam. Uma conversa só, que nunca acaba (o contexto recente vai no prompt).
import { CHAT_PRINCIPLES } from '@shared/pipo-principles';
import { describePlaybook } from '@shared/plan-check';
import { PIPO_COLORS, type Pipo, type PipoRun } from '@shared/pipos';
import type { MessageAuthor } from '@shared/team';
import { runRaw } from '../agent/service';
import { emit } from '../bus';
import { addMessage, createConversation, getConversation, listMessages, setConversationSession } from '../db/repos/conversations';
import { getProfile } from '../db/repos/profile';
import { getKV, setKV } from '../db/repos/settings';
import { inputFiles } from '../files/for-agent';
import { startRun } from '../pipos/deps';
import { getLive } from '../pipos/live';
import { runOutputs } from '../pipos/links';
import { activePlaybook, getPipo, lastRun, listMemory, listPipos, listRuns, runSteps } from '../pipos/repo';
import { runDone } from '../pipos/runner';
import { scheduleLabel } from '../pipos/triggers';
import { factsText } from './facts';

const CONV_KEY = 'team:conv';
const DAY_KEY = 'team:sessionDay';
export const TEAM_GREETING =
  'Este é o chat geral: aqui você fala com a equipe inteira. Peça o que precisar que eu passo para o Pipo certo, ou chame um deles com @nome. Eles avisam aqui quando pegam e quando terminam uma tarefa.';

/** A conversa do chat geral (cria na primeira vez). */
export function teamConversation(): number {
  const id = getKV<number | null>(CONV_KEY, null);
  if (id && getConversation(id)) return id;
  const conv = createConversation('Chat geral da equipe');
  setKV(CONV_KEY, conv.id);
  addMessage(conv.id, 'assistant', TEAM_GREETING);
  return conv.id;
}

export function isTeamConversation(conversationId: number): boolean {
  return getKV<number | null>(CONV_KEY, null) === conversationId;
}

/** Uma vez por dia a sessão do modelo recomeça: a conversa não cresce para sempre. */
export function refreshTeamSession(conversationId: number, now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  if (getKV<string | null>(DAY_KEY, null) === day) return;
  setKV(DAY_KEY, day);
  setConversationSession(conversationId, null);
}

export const authorOf = (p: Pipo): MessageAuthor => ({ name: p.name, slug: p.slug, color: PIPO_COLORS[p.color], accessory: p.accessory });

/** Fala de um Pipo colorido no chat geral. */
export function postAs(p: Pipo, text: string, model: string | null = null): void {
  const conv = teamConversation();
  addMessage(conv, 'assistant', text.trim(), [], model, authorOf(p));
  emit('chat:changed', { conversationId: conv });
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function findPipo(ref: unknown): Pipo {
  const k = String(ref ?? '').trim().replace(/^@/, '').toLowerCase();
  const all = listPipos();
  const p = all.find((x) => x.slug === k) ?? all.find((x) => x.name.toLowerCase() === k) ?? all.find((x) => x.slug.includes(k) || x.name.toLowerCase().includes(k));
  if (!p || !k) throw new Error(`Não existe Pipo "${String(ref ?? '')}". Veja a equipe com team_status.`);
  return p;
}

export function teamStatus(): Array<Record<string, unknown>> {
  return listPipos().map((p) => {
    const last = lastRun(p.id);
    const live = getLive(p.id);
    return {
      nome: p.name,
      slug: p.slug,
      missao: p.personality.mission,
      contratado: !!p.activeVersion,
      pausado: p.paused,
      agenda: scheduleLabel(p.id) ?? 'só quando pedem',
      agora: live.state === 'working' || live.state === 'waiting' ? `trabalhando (${live.stepLabel ?? '…'})` : 'livre',
      ultima: last ? { status: last.status, quando: last.startedAt, resumo: last.summary, erro: last.error } : null,
    };
  });
}

/** As últimas falas do chat, para quem entra sem ter visto (a sessão recomeça; os Pipos não têm sessão). */
export function recentChat(limit = 10): string {
  const id = getKV<number | null>(CONV_KEY, null);
  if (!id) return '';
  return listMessages(id)
    .slice(-limit)
    .map((m) => `${m.role === 'user' ? 'Usuário' : (m.author?.name ?? 'Pipo branco')}: ${clip(m.text.replace(/\s+/g, ' '), 320)}`)
    .join('\n');
}

/** O que o chat geral acrescenta ao prompt do Pipo branco. */
export function buildTeamPrompt(): string {
  const team = teamStatus().filter((p) => p.contratado);
  const roster = team.length
    ? team.map((p) => `- ${String(p.nome)} (@${String(p.slug)}): ${String(p.missao || 'sem missão escrita')}. Roda: ${String(p.agenda)}.${p.pausado ? ' PAUSADO.' : ''} Agora: ${String(p.agora)}.${p.ultima ? ` Última: ${String((p.ultima as { status: string }).status)}.` : ' Ainda não rodou.'}`).join('\n')
    : 'A equipe ainda não tem Pipos coloridos contratados. Para trabalho recorrente, sugira instalar um pronto na Loja (aba Equipe) ou criar um (/criarpipo).';
  const recent = recentChat();
  return [
    'CHAT GERAL DA EQUIPE: nesta conversa o usuário fala com a equipe inteira. Você, o Pipo branco, modera e responde por padrão; os Pipos coloridos entram quando o assunto é o trabalho deles.',
    `Equipe:\n${roster}`,
    `Como agir aqui:
- Conversa, dúvida geral, tarefas e agenda do usuário: responda você mesmo, com as ferramentas de sempre.
- Pedido que é o trabalho de um Pipo ("prospecta mais 10", "posta o vídeo de hoje"): chame assign_pipo com o pedido em uma frase. Ele avisa no chat quando pega e quando termina; não espere, a não ser que você precise do resultado para o passo seguinte (wait: true).
- Pergunta ou opinião para um Pipo ("@prospector, por que falhou ontem?", "o que o financeiro acha?"): chame ask_pipo. A resposta dele já aparece no chat com o nome dele: não repita o que ele disse; só complemente se faltar algo, em uma linha.
- Mensagem que começa com @nome é para aquele Pipo.
- Trabalho em conjunto: assign_pipo com wait: true no primeiro e passe o resultado em "context" para o próximo; ou peça a visão de mais de um com ask_pipo e feche com uma conclusão de 2 linhas.
- "Equipe, o que acham?": ask_pipo para cada Pipo que tem a ver (no máximo 4) e depois a sua síntese.
- Nunca fale no lugar de um Pipo colorido nem invente o que ele fez ou faria: pergunte a ele.
- team_status mostra como cada um está. delete_pipo exclui um Pipo quando o usuário pedir.`,
    recent ? `Conversa recente (falas dos Pipos e relatos de execução incluídos; a sua sessão pode ter recomeçado):\n${recent}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** O Pipo colorido responde no chat geral, com a personalidade e os fatos do trabalho dele. */
export async function askPipo(p: Pipo, message: string, signal: AbortSignal): Promise<string> {
  const v = activePlaybook(p.id);
  const rules = listMemory(p.id).map((m) => m.rule);
  const runs = listRuns(p.id, 4).filter((r) => !r.dryRun);
  const failed = runs.find((r) => r.status === 'failed');
  const brokenStep = failed ? runSteps(failed.id).find((s) => s.status === 'failed') : null;
  const user = getProfile()?.name || 'o usuário';
  const system = [
    `Você é o Pipo ${p.name} (@${p.slug}), um Pipo colorido da equipe de ${user}, falando no chat geral (o usuário, o Pipo branco e os outros Pipos leem).`,
    `Missão: ${p.personality.mission || '—'}. Tom: ${p.personality.tone || 'direto e simpático'}. Você nunca: ${p.personality.never.join('; ') || '—'}.`,
    rules.length ? `Regras que você aprendeu:\n${rules.map((r) => `- ${r}`).join('\n')}` : null,
    v ? `Seu plano de execução (v${v.version}):\n${describePlaybook(v.playbook).map((s) => `${s.title} — ${s.detail}`).join('\n')}` : 'Você ainda não tem um plano contratado.',
    `Quando roda: ${scheduleLabel(p.id) ?? 'só quando pedem'}${p.paused ? ' (PAUSADO)' : ''}.`,
    runs.length ? `Suas últimas execuções: ${runs.map((r) => `#${r.id} ${r.status} em ${new Date(r.startedAt).toLocaleString('pt-BR')} — ${r.summary ?? r.error ?? ''}`).join(' | ')}` : 'Você ainda não rodou de verdade.',
    brokenStep ? `Na última falha, o passo que quebrou foi "${brokenStep.title}": ${brokenStep.error ?? 'sem detalhe'}.` : null,
    factsText(),
    'Fale em português do Brasil, na primeira pessoa, em no máximo 4 linhas, sem markdown pesado. Responda pelo seu trabalho; se o assunto for de outro Pipo, diga de quem é.',
    'Nunca invente números nem resultados: use só o que está acima. Se não souber, diga o que falta.',
    `Daqui você não roda nem muda o plano: se for preciso rodar, diga que pega a tarefa (o Pipo branco te passa); para mudar o plano, sugira "/editarpipo ${p.slug}".`,
    CHAT_PRINCIPLES,
  ]
    .filter(Boolean)
    .join('\n');
  const recent = recentChat(8);
  return runRaw({ system, prompt: `${recent ? `Conversa recente no chat geral:\n${recent}\n\n` : ''}Mensagem para você:\n${message}`, model: p.model, effort: 'low', readDirs: [], signal });
}

/** Execuções pedidas pelo chat geral (o relato final sempre volta para lá). */
const teamRuns = new Set<number>();
const sleep = <T>(ms: number, value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms).unref?.());

export interface AssignResult {
  pegou: boolean;
  execucao: number | null;
  na_fila?: boolean;
  terminou?: boolean;
  status?: string;
  resumo?: string | null;
  metricas?: Record<string, number>;
  erro?: string | null;
  saidas?: string;
  aviso?: string;
}

/** Um Pipo pega uma tarefa pelo chat geral: roda o plano dele com o pedido como entrada. */
export async function assignPipo(o: { pipo: Pipo; request: string; files?: string[]; context?: string | null; wait?: boolean; dryRun?: boolean; waitMs?: number }): Promise<AssignResult> {
  const { pipo: p } = o;
  if (!p.activeVersion) throw new Error(`${p.name} ainda não foi contratado (não tem plano). Termine a criação dele primeiro.`);
  const files = o.files?.length ? await inputFiles(o.files) : [];
  const input = { pedido: o.request, arquivos: files, contexto: o.context ?? null };
  const started = startRun(p.id, { dryRun: !!o.dryRun, trigger: 'chat', input });
  void started.then((id) => id && teamRuns.add(id)).catch(() => undefined);
  // Com a fila cheia (ou ele ocupado), a execução demora a começar: o chat não fica esperando.
  const runId = await Promise.race([started, sleep(4000, undefined)]);
  postAs(p, runId === undefined ? `Peguei: ${o.request} Estou terminando outra coisa; começo em seguida e aviso aqui.` : `Peguei: ${o.request} Aviso aqui quando terminar.`);
  if (!o.wait || !runId) return { pegou: true, execucao: runId ?? null, na_fila: runId === undefined };
  const done = await Promise.race([runDone(runId), sleep(o.waitMs ?? 8 * 60_000, null)]);
  if (!done) return { pegou: true, execucao: runId, terminou: false, aviso: 'Ainda está rodando; ele avisa no chat quando terminar.' };
  return { pegou: true, execucao: runId, terminou: true, status: done.status, resumo: done.summary, metricas: done.metrics, erro: done.error, saidas: clip(JSON.stringify(runOutputs(p.slug, runId)), 6000) };
}

/** Relato de uma execução no chat geral: sempre que foi pedida ali, quando falha ou quando produziu algo. */
export function reportRun(run: PipoRun): boolean {
  const fromTeam = teamRuns.delete(run.id);
  if (run.dryRun) return false;
  const produced = Object.values(run.metrics).some((v) => v > 0);
  if (!fromTeam && run.status !== 'failed' && !produced) return false;
  const p = getPipo(run.pipoId);
  if (!p) return false;
  const summary = (run.summary ?? '').replace(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`), '');
  const text = run.status === 'done' ? `Terminei. ${summary.charAt(0).toUpperCase()}${summary.slice(1)}` : run.status === 'cancelled' ? 'Parei: a execução foi cancelada.' : `Não consegui terminar: ${run.error ?? 'deu erro'}`;
  postAs(p, text);
  return true;
}
