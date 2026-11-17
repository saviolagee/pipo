// Registro da equipe: memória compartilhada, chat geral e as ferramentas que o Pipo branco usa nele.
import { promptHooks } from '../agent/service';
import { emit } from '../bus';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { removePipo } from '../pipos/ipc';
import { getPipo } from '../pipos/repo';
import { runnerHooks } from '../pipos/runner';
import { askPipo, assignPipo, buildTeamPrompt, findPipo, isTeamConversation, postAs, refreshTeamSession, reportRun, teamConversation, teamStatus } from './chat';
import { addFact, deleteFact, factsText, forgetFact, listFacts } from './facts';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function registerTeam(): void {
  promptHooks.extra = factsText;
  promptHooks.team = buildTeamPrompt;
  const prev = promptHooks.modeFor;
  promptHooks.modeFor = (conversationId) => {
    const r = prev?.(conversationId);
    if (r) return r;
    if (!isTeamConversation(conversationId)) return null;
    refreshTeamSession(conversationId);
    return { mode: 'team' };
  };
  runnerHooks.finished.push((run) => void reportRun(run));

  registerTools([
    {
      name: 'remember_fact',
      description:
        'Guarda na memória da equipe um fato duradouro sobre o usuário ou o negócio dele (o que vende, para quem, preços, concorrentes, preferências). O Pipo branco e todos os Pipos coloridos passam a saber. Uma frase curta por fato. Não use para tarefas do dia, senhas nem dados de cartão.',
      inputSchema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
      run: (a, ctx) => {
        const author = ctx.pipoId ? getPipo(ctx.pipoId) : null;
        const f = addFact(str(a.fact), author ? `@${author.slug}` : 'chat');
        emit('toast:show', { id: `fact:${f.id}`, text: `A equipe guardou: ${f.text}`, durationMs: 5000 });
        return { guardado: f.text };
      },
    },
    {
      name: 'forget_fact',
      description: 'Apaga da memória da equipe o fato que mais parece com o texto dado (quando o usuário diz que mudou ou pede para esquecer).',
      inputSchema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
      run: (a) => {
        const f = forgetFact(str(a.fact));
        return f ? { apagado: f.text } : { apagado: null, fatos: listFacts().map((x) => x.text) };
      },
    },
    {
      name: 'team_status',
      modes: ['team', 'chat'],
      description: 'A equipe de Pipos coloridos: missão, agenda, se está trabalhando agora e como foi a última execução de cada um.',
      inputSchema: { type: 'object', properties: {} },
      run: () => teamStatus(),
    },
    {
      name: 'ask_pipo',
      modes: ['team'],
      description:
        'Faz uma pergunta ou pede a opinião de um Pipo colorido no chat geral. A resposta dele aparece no chat com o nome e a cor dele (não repita). Use para dúvidas sobre o trabalho dele, por que algo falhou, ou a visão dele sobre um assunto. Para ele EXECUTAR o trabalho, use assign_pipo.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string', description: '@nome do Pipo' }, message: { type: 'string' } }, required: ['slug', 'message'] },
      run: async (a) => {
        const p = findPipo(a.slug);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3 * 60_000);
        try {
          const text = await askPipo(p, str(a.message), ac.signal);
          if (!text) throw new Error(`${p.name} não respondeu.`);
          postAs(p, text, p.model);
          return { de: `@${p.slug}`, ja_apareceu_no_chat: true, resposta: text };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    {
      name: 'assign_pipo',
      modes: ['team'],
      description:
        'Passa uma tarefa para um Pipo colorido: ele roda o plano dele agora, recebendo o pedido em {{entrada.pedido}}, os arquivos em {{entrada.arquivos}} e o que outro Pipo produziu em {{entrada.contexto}}. Ele mesmo avisa no chat quando pega e quando termina. Com wait: true você recebe o resultado (para passar adiante a outro Pipo).',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: '@nome do Pipo' },
          request: { type: 'string', description: 'O pedido, em uma frase.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Caminhos de arquivos anexados nesta conversa.' },
          context: { type: 'string', description: 'Resultado de outro Pipo ou informação que ele precisa para esta tarefa.' },
          wait: { type: 'boolean', description: 'Esperar terminar (até 8 min) e devolver o resultado.' },
          dry_run: { type: 'boolean', description: 'Ensaio: nada sai da máquina.' },
        },
        required: ['slug', 'request'],
      },
      run: (a) => assignPipo({ pipo: findPipo(a.slug), request: str(a.request), files: Array.isArray(a.files) ? a.files.map(String) : [], context: str(a.context) || null, wait: a.wait === true, dryRun: a.dry_run === true }),
    },
    {
      name: 'delete_pipo',
      modes: ['team', 'chat'],
      description: 'Exclui um Pipo colorido de vez (plano, histórico, arquivos e chaves). Só quando o usuário pedir. Pede confirmação.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
      confirm: (a) => {
        const p = findPipo(a.slug);
        return { label: 'Excluir Pipo', subject: `Excluir ${p.name} (@${p.slug}), o plano e o histórico dele? Não dá para desfazer.`, confirm: 'Excluir' };
      },
      run: (a) => {
        const p = findPipo(a.slug);
        removePipo(p.id);
        return { excluido: p.name };
      },
    },
  ]);

  handle('team:chat', () => ({ conversationId: teamConversation() }));
  handle('team:facts', () => listFacts());
  handle('team:addFact', (text) => {
    addFact(text, 'manual');
    return listFacts();
  });
  handle('team:deleteFact', (id) => {
    deleteFact(id);
    return listFacts();
  });
}
