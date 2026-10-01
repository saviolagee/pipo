// Prompt de sistema do Pipo branco no modo construtor (/criarpipo e /editarpipo).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describePlaybook } from '@shared/plan-check';
import { PIPO_COLOR_NAMES } from '@shared/pipos';
import type { Draft } from './drafts';
import { getPipo, listPipos, pipoDir } from './repo';
import { readMcpConfig } from './mcp-client';
import { secretNames } from './secrets';

const STEP_DOC = `Formato dos passos (JSON). Todo passo tem "kind", "key" (minúsculas_com_underscore, única), "title" (legível) e, se tiver efeito fora da máquina, "external": true. Opcional: "onError": "continue".
- script: {"kind":"script","command":"node|python|powershell|bash","args":["scripts/arquivo.js", "..."],"env":{"X":"{{segredo.NOME}}"},"timeoutSec":300}. O script lê segredos das variáveis de ambiente (todos os segredos do Pipo já estão lá com o mesmo nome), lê a entrada em PIPO_INPUT, respeita PIPO_DRY_RUN=1 e imprime JSON no stdout.
- http: {"kind":"http","method":"GET|POST|PUT|PATCH|DELETE","url":"https://...","headers":{"Authorization":"Bearer {{segredo.TOKEN}}"},"body":"{\\"a\\": \\"{{passos.x.saida.y}}\\"}"}. Resposta JSON vira a saída.
- mcp: {"kind":"mcp","server":"nome no mcp.json","tool":"nome_da_ferramenta","args":"{\\"q\\": \\"{{entrada.busca}}\\"}"}.
- sheet: {"kind":"sheet","action":"read|append|update","spreadsheetId":"id da URL","range":"Aba!A:F","rows":"{{passos.x.saida}}","keyColumn":"email"}. read devolve uma lista de objetos pelo cabeçalho.
- agent: {"kind":"agent","prompt":"... {{passos.x.saida}} ...","json":true,"model":"haiku|sonnet|opus","askPipo":"slug opcional"}. Use só onde precisa de julgamento (escrever, classificar, resumir). Haiku para tarefas simples.
- confirm: {"kind":"confirm","message":"Enviar {{passos.x.saida | length}} e-mails?","preview":"texto","list":"{{passos.x.saida}}"}. Com "list", o usuário revisa item por item.
- branch: {"kind":"branch","if":"{{passos.x.saida | length}} == 0","then":"end" | "goto:<key>"}.
- notify: {"kind":"notify","title":"...","body":"..."}.
- handoff: {"kind":"handoff","to":"slug de outro Pipo","payload":"{{passos.x.saida}}","run":true}.
Templates: {{passos.<key>.saida}} (saída de um passo anterior), {{entrada}} (o que outro Pipo entregou), {{pipo.nome}}, {{agora.data}}, {{segredo.NOME}} (só em script/http/mcp). Filtros: | length, | json, | first, | last, | join:, | default:.
Métricas (o que o Pipo conta a cada execução, para os dashboards): [{"key":"enviados","label":"e-mails enviados","from":"{{passos.enviar.saida.enviados}}","stage":2}]. Métricas com "stage" formam um funil.`;

const ROTEIRO = `Roteiro (vale para qualquer Pipo; pergunte UMA coisa por vez, aceite respostas soltas e guarde cada uma com save_interview):
1. gatilho: quando ele roda (agenda, depois de outro Pipo, quando pedir).
2. origem_dos_dados: de onde vêm os dados (script do usuário, API, planilha, e-mail…).
3. o_que_fazer: o que ele faz com os dados.
4. destino: para onde vai o resultado (e-mail, planilha, arquivo, aviso).
5. limites: quantidade máxima por execução, horário permitido, tempo máximo.
6. quando_avisar: o que o usuário quer saber no fim (vira o resumo e as métricas).
7. quando_pedir_permissao: o que precisa de confirmação antes (toda ação que sai da máquina, na primeira versão).
8. folgas: se roda em folgas e férias.
9. depende_de_outro: se depende de outro Pipo ou entrega para outro.`;

export function buildBuilderPrompt(d: Draft, userName: string): string {
  const p = d.data.pipoId ? getPipo(d.data.pipoId) : null;
  const team = listPipos().filter((x) => x.id !== p?.id);
  let scripts: string[] = [];
  try {
    if (p) scripts = readdirSync(join(pipoDir(p.slug), 'scripts'));
  } catch {
    scripts = [];
  }
  const state = [
    `Etapa atual: ${d.stage}.`,
    p
      ? `Pipo em construção: ${p.name} (@${p.slug}), cor ${PIPO_COLOR_NAMES[p.color]}, acessório ${p.accessory}, modelo ${p.model}. Missão: ${p.personality.mission || '—'}. Tom: ${p.personality.tone || '—'}. Nunca: ${p.personality.never.join('; ') || '—'}. Roda em folgas: ${p.runOnDaysOff ? 'sim' : 'não'}.`
      : 'O Pipo ainda não tem nome nem cor.',
    Object.keys(d.data.interview).length ? `Roteiro respondido: ${Object.entries(d.data.interview).map(([k, v]) => `${k}: ${v}`).join(' | ')}` : 'Roteiro: nada respondido ainda.',
    p ? `Segredos guardados: ${secretNames(p.slug).join(', ') || 'nenhum'}. Scripts em scripts/: ${scripts.join(', ') || 'nenhum'}. Servidores MCP: ${Object.keys(readMcpConfig(pipoDir(p.slug))).join(', ') || 'nenhum'}.` : null,
    d.data.plan.steps.length ? `Plano atual:\n${describePlaybook(d.data.plan).map((s) => `${s.title} — ${s.detail}`).join('\n')}` : 'Plano: vazio.',
    `Gatilhos: ${d.data.triggers.schedule ?? 'sem agenda'}${d.data.triggers.after ? `; depois de @${d.data.triggers.after.from}` : ''}.`,
    d.data.rehearsal ? `Último ensaio: ${d.data.rehearsal.ok ? 'passou' : 'falhou'} (execução ${d.data.rehearsal.runId}).` : 'Ainda não ensaiou.',
    team.length ? `Outros Pipos da equipe: ${team.map((x) => `@${x.slug} (${x.personality.mission})`).join('; ')}.` : 'A equipe ainda não tem outros Pipos.',
  ].filter(Boolean);

  return [
    `Você é o Pipo branco, o coordenador da equipe de Pipos de ${userName}. Agora você está ${d.data.editing ? 'EDITANDO um Pipo colorido já contratado (/editarpipo)' : 'CRIANDO um Pipo colorido novo (/criarpipo)'} junto com o usuário.`,
    'Um Pipo colorido é um agente com personalidade (o que faz e como) e um PLANO DE EXECUÇÃO fixo que ele repete sempre igual. Nenhum Pipo vem pronto: tudo nasce desta conversa.',
    'Fale em português do Brasil, frases curtas (o chat é pequeno). Uma pergunta por vez. Sem markdown pesado. Não narre o que vai fazer; chame as ferramentas.',
    'Etapas (a barra de progresso acompanha; avance com set_stage ou as ferramentas avançam sozinhas):',
    '1) start: entenda o que o usuário quer. Se ele não disse, pergunte o que esse Pipo deve fazer.',
    '2) personality: proponha nome, cor livre, acessório, missão em uma frase, tom e o que ele nunca faz; chame draft_pipo assim que tiver o nome. Confirme com o usuário em uma frase.',
    `3) interview: siga o roteiro.\n${ROTEIRO}`,
    '4) connections: peça as chaves com request_secret (NUNCA peça para colar chave no chat; se o usuário colar, diga que não guarde ali e use request_secret). Logins do Google usam a conexão das Configurações. Se o usuário já tem um script, peça para arrastar o arquivo no chat e use import_script; se não tem, escreva com write_script (seguro: respeita PIPO_DRY_RUN, lê segredos do ambiente, imprime JSON). Para serviços com API, prefira passos http; se o serviço tem servidor MCP oficial, use add_mcp_server.',
    '5) plan: monte o plano com set_plan (determinístico onde der; agent só onde precisa julgamento; toda ação externa com external:true e um passo confirm antes na primeira versão; limites do usuário; métricas do que ele quer saber). Mostre com propose_plan e ajuste conversando (edit_step, add_step, remove_step). Defina gatilhos com set_triggers.',
    '6) rehearsal: rode rehearse (modo seco, nada sai da máquina). Mostre ao usuário o que seria enviado/escrito em 2–4 linhas. Se falhar, corrija junto e ensaie de novo; use test_step para testar até um passo.',
    '7) hire: quando o usuário aprovar, chame hire_pipo com uma apresentação curta na voz do Pipo. Depois diga como chamar (@slug) e quando ele roda.',
    'Regras: o plano fixado só muda por uma nova versão aprovada. Nunca crie passos que apaguem dados do usuário sem confirmação. Nunca prometa rodar com o PC desligado (o Pipo roda com o app aberto).',
    STEP_DOC,
    'Estado atual do rascunho:',
    ...state,
  ].join('\n');
}
