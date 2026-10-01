# PLANO V2 — Equipe de Pipos

A V1 entregou o Pipo branco: notch, mascote, tarefas, foco, atividade, integrações e o agente via
Claude Code. A V2 transforma o Pipo numa **equipe**. O Pipo branco continua como o coordenador, e cada
**Pipo colorido** é um agente especializado que executa um processo fixo, montado conversando com ele.

Mesmas regras da V1:

- **Ordem e commits:** fases em ordem, cada uma validada pelo seu aceite e commitada como
  `feat(fase-N): ...`. A numeração continua da V1.
- **Visual = funcionalidade:** o visual tem o mesmo peso da funcionalidade.
- **Código:** TypeScript estrito, sem `any`.
- **Textos:** textos de interface em `src/renderer/i18n/pt-BR.ts`.
- **Flags do CLI:** confirmadas em `claude --help` antes de usar. Versão de referência: 2.1.287.

---

## 0. Exemplo-guia: Pipo Prospector

É o caso que guia todas as decisões. Se ele funcionar ponta a ponta, a V2 está pronta.

> "Pipo, cria um Pipo prospector: ele roda meu script que puxa e-mails do Apify, manda a sequência
> pelo Resend, atualiza a planilha de leads e me avisa."

1. **Montagem no chat.** O Pipo branco entrevista o usuário: onde está o script, qual actor do Apify,
   qual template de e-mail, qual planilha e qual coluna marca "enviado".
2. **Rascunho.** O Pipo propõe o **processo**, uma lista de passos.
3. **Ensaio.** Ele roda cada passo em modo seco: puxa os leads, mostra 3 e-mails renderizados e simula
   a atualização da planilha.
4. **Fixação.** O usuário aprova e o processo vira a **versão 1** do Pipo Prospector (cor laranja).
5. **Disparo.** A partir daí ele roda quando o usuário define ("seg–sex às 9h"), quando o usuário pede
   ("@prospector roda agora") ou pelo botão.
6. **Durante a execução.** O mini-Pipo laranja fica **aceso** na pill.
7. **No fim.** Aparece um card:

   > "Prospector: 48 leads novos, 45 e-mails enviados, 3 inválidos, planilha atualizada."

8. **Ajustes depois.** O usuário conversa com o Prospector no chat dele: "por que 3 falharam?",
   "a partir de amanhã, manda no máximo 30". Uma mudança no processo gera a versão 2, com diff e
   confirmação.

---

## 1. Modelo do agente

**Hoje:** o `ClaudeCodeProvider` não passa `--model`, então vale o modelo do Claude Code do usuário.

**Na V2:**

- **Padrão `sonnet`.** O alias resolve para o Sonnet mais recente (Sonnet 5.5 hoje). É mais rápido e
  gasta menos do limite da assinatura.
- **Configurações → Agente → Modelo:**
  - Sonnet (padrão)
  - Opus (mais capaz)
  - Haiku (mais rápido)
  - "Mesmo do terminal" (não passa `--model`)
- **Effort:** `--effort` com `low`, `medium` ou `high`. O padrão é `medium`.
- **Botão "Pensar mais"** no chat: refaz a última resposta com `--model opus --effort high`.
- **Modelo por Pipo:** cada Pipo colorido pode ter modelo e effort próprios. Exemplo: o Prospector usa
  Haiku nos passos mecânicos e Sonnet no resumo.
- **Fallback:** sempre passar `--fallback-model` com a lista seguinte. Sonnet cai para Haiku; Opus cai
  para Sonnet e depois Haiku.
- **Modelo visível:** o modelo usado aparece discreto no rodapé de cada resposta. O valor sai do evento
  `system/init` do stream-json, não do que foi pedido.
- **Provedor por API:** passa a ter o mesmo seletor. O padrão vira `claude-sonnet-5-5`.

---

## 2. Conceito: Pipo colorido

Um Pipo é um agente com identidade e um **processo fixo versionado**.

| Campo | Exemplo |
|---|---|
| nome, cor, acessório | Prospector, laranja, boné |
| descrição | "Prospecção fria por e-mail" |
| instruções | prompt próprio, anexado ao prompt de sistema base |
| processo (playbook) | lista de passos, com versões v1, v2… |
| gatilhos | manual, agenda, chat, evento |
| permissões | quais scripts, ferramentas MCP e pastas ele pode usar |
| segredos | `APIFY_TOKEN`, `RESEND_API_KEY` (cofre, nunca no prompt) |
| limites | máx. 50 e-mails/execução, só entre 8h e 18h, timeout de 15 min |
| memória | aprendizados ("não mandar para domínios .gov") |
| modelo / effort | sonnet / medium |

O Pipo branco é o **coordenador**. Ele conversa com o usuário, cria e edita os outros Pipos, delega
pedidos ("roda o prospector") e junta os relatórios no resumo do dia.

### 2.1 Passos do processo

O processo é **determinístico onde dá** e usa o agente só onde precisa de julgamento. Isso garante que
o "processo fixo" se repita igual toda vez.

| Tipo | O que faz | Quem executa |
|---|---|---|
| `script` | roda um comando (node/python/ps1) da pasta do Pipo com args, env e timeout; captura stdout JSON | executor do app, direto via `child_process` |
| `http` | chamada a uma API conhecida (Apify, Resend, Sheets) por conector | executor do app |
| `agent` | prompt ao Claude com as saídas dos passos anteriores (ex.: personalizar o e-mail, classificar leads) | `claude -p` com as permissões do Pipo |
| `confirm` | pede Y/N ao usuário, com prévia (ex.: "enviar 45 e-mails?") | card no notch |
| `branch` | condição simples sobre a saída anterior (`leads.length == 0` → encerra) | executor |
| `notify` | card, som ou notificação do sistema | executor |

- **Saídas:** cada passo grava a saída em `runs/<id>/<passo>.json`. Os passos seguintes referenciam
  `{{passos.puxar.saida.leads}}`.
- **Resumo final:** um passo `agent` com Haiku escreve o card a partir dos números.

### 2.2 Segurança (inegociável)

- **Bash restrito.** Um Pipo só roda os scripts da própria pasta. Quando um passo `agent` precisa de
  shell, ele recebe `--allowedTools` com padrões exatos, como `Bash(node scripts/puxar.js:*)`. Nunca
  `Bash` livre.
- **Segredos.** Ficam no cofre (`safeStorage`) e são injetados como variáveis de ambiente só no
  processo do passo. Não vão para o prompt nem para os logs (máscara automática no stdout).
- **Ações externas.** Enviar e-mail, escrever na planilha ou postar exige um passo `confirm` na
  primeira versão. O usuário pode trocar por "sempre permitir" por Pipo e por passo, com limite
  numérico obrigatório.
- **Modo seco.** Todo passo `http` ou `script` recebe `PIPO_DRY_RUN=1` e precisa respeitar. O ensaio
  da montagem sempre roda nesse modo.
- **Pausa automática.** 3 falhas seguidas pausam o Pipo e avisam o usuário. Há um botão "parar tudo"
  na bandeja.
- **Mudanças no processo.** Toda mudança mostra o diff e pede confirmação. O agente nunca altera o
  processo fixado sozinho.

---

## 3. Visual

- **Paleta de 8 cores:**
  - laranja `#FF8A3D`
  - azul `#4D8DFF`
  - verde `#3DDC84`
  - rosa `#FF5FA2`
  - roxo `#A77BFF`
  - amarelo `#FFD23F`
  - ciano `#3FD8E0`
  - vermelho `#FF5A5A`

  Mesmo corpo marshmallow, só a cor muda. Os olhos continuam pretos.
- **Pill reduzida.** À direita do Pipo branco ficam os **mini-Pipos** coloridos, em 12px, até 4
  visíveis e depois "+2".
  - **Apagado:** cor a 30% e olhos fechados. O Pipo está ocioso.
  - **Aceso:** cor cheia, glow suave da própria cor e olhos piscando/olhando. Está trabalhando.
  - **Esperando você:** aceso com um pulso lento e um ponto branco. Há um `confirm` pendente.
  - **Erro:** um ponto vermelho, sem chacoalhar (sem drama).
  - **Concluiu:** pulinho e 1s de brilho, depois apaga.
- **Hover em um mini-Pipo:** tooltip com o passo atual ("Prospector · enviando 23/45").
- **Clique em um mini-Pipo:** expande o notch direto na execução dele.
- **Aba "Equipe" no notch expandido.** Cartões dos Pipos com status, última execução, próxima execução,
  botões ▶ Rodar / ⏸ Pausar e acesso ao chat.
- **Tela de execução.** Linha do tempo vertical dos passos (✓ / ⟳ / ✕) com duração e saída resumida.
  Dá para expandir o log bruto.
- **Chat.** Um seletor de Pipo no topo do chat. Também dá para usar `@prospector` no chat do branco,
  que delega e mostra a resposta com a cor do Pipo. Cada Pipo tem a própria conversa (`--resume`
  próprio).
- **Acessórios por Pipo.** Boné, fone, lupa, gravata… escolhidos na criação. Os desbloqueios de
  sequência da V1 continuam só no branco.

---

## 4. Análises

Duas frentes.

### 4.1 Análise das suas ações (produtividade, aprofunda a V1)

- **Painel "Análises"** com semana e mês: horas por cliente e tipo de tarefa, foco vs. distração, metas
  batidas, tarefas adiadas e tendência do humor.
- **Pergunta livre:** "onde foi meu tempo em setembro?" O agente consulta só agregados. Títulos crus
  continuam exigindo confirmação.
- **Rentabilidade por cliente:** horas × valor/hora cadastrado vs. valor do contrato.
- **Relatório semanal automático** na sexta, como card e, opcionalmente, como e-mail para o próprio
  usuário.

### 4.2 Análise das ações dos Pipos (o que a equipe fez)

- **Auditoria:** cada execução fica com passos, entradas, saídas, duração, quem disparou e versão do
  processo.
- **Métricas por Pipo:** execuções, taxa de sucesso, duração média e tempo economizado estimado
  (o usuário informa "isso me levava X min").
- **Funil do Prospector:** leads → enviados → entregues → abertos → respondidos. Os eventos vêm da API
  do Resend e as respostas do Gmail. Mostra comparação entre versões do template.
- **Pergunta livre:** "qual assunto de e-mail teve mais resposta?"

### 4.3 Pipo Investidor (template, se "ações" for bolsa)

- **Carteira e cotações:** carteira cadastrada; cotações B3 por API pública (ex.: brapi.dev).
- **Resumos:** na abertura e no fechamento, com variação do dia e notícias dos papéis.
- **Alertas:** de preço configuráveis.
- **Postura:** só informa. Não executa ordens e mostra o aviso "não é recomendação".

---

## 5. O que mais pode ter (backlog priorizado)

**Alta — entram na V2:**

- **Templates prontos:** Prospector, Follow-up (lembra/escreve para leads sem resposta após N dias),
  Relatório para cliente (horas da semana → PDF → e-mail), Triagem da caixa de entrada.
- **Encadeamento:** quando o Prospector termina, o Follow-up é agendado para +3 dias com os mesmos
  leads.
- **Gatilhos por evento:**
  - e-mail novo com marcador X;
  - arquivo novo numa pasta;
  - fim de reunião;
  - webhook local (`127.0.0.1`).
- **Aprovação em lote:** revisar os 45 e-mails num carrossel antes de enviar, editar um e pular outro.
- **Memória por Pipo:** o usuário corrige no chat ("não manda pra concorrente X") e isso vira regra
  persistente, visível e editável.

**Média:**

- **Avisos no celular:** notificação via Telegram (bot próprio) ou ntfy quando o usuário está longe do
  PC. Responder pelo Telegram dispara o Pipo ("/prospector rodar").
- **Exportar/importar Pipo** (`.pipo`, sem segredos) para compartilhar com outras pessoas.
- **Ciência do limite da assinatura:** ler os eventos `rate_limit_event` do stream-json. Perto do
  limite, adiar execuções não urgentes e avisar.
- **Autoconserto:** quando um script falha, o Pipo lê o erro, propõe um patch (diff) e só aplica com
  Y. Isso gera uma nova versão.
- **Horário comercial por Pipo** e fila: execuções fora da janela esperam.

**Baixa / V3:**

- Pipo Conteúdo (rascunha posts a partir do que foi feito na semana).
- Pipo Financeiro (cobra faturas vencidas e concilia o extrato).
- Pipo Monitor (site fora do ar, preço de concorrente).
- Execução na nuvem para Pipos que precisam rodar com o PC desligado.

---

## 6. Dados (migração 002)

```
pipos(id, slug, name, color, accessory, description, instructions, model, effort,
      paused, active_version, created_at)
pipo_versions(id, pipo_id, version, playbook_json, changelog, created_at, approved_at)
pipo_triggers(id, pipo_id, kind[manual|schedule|event], spec_json, enabled, last_fired_at)
pipo_runs(id, pipo_id, version, trigger, status[queued|running|waiting|done|failed|cancelled],
          dry_run, started_at, finished_at, summary, metrics_json)
pipo_run_steps(id, run_id, step_key, status, started_at, finished_at, output_path, error)
pipo_memory(id, pipo_id, rule, source, created_at)
pipo_permissions(pipo_id, step_key, always_allow, limit_n)
```

- **Segredos:** em `secrets` (já existe), com a chave `pipo:<slug>:<NOME>`.
- **Arquivos de cada Pipo:** `userData/pipos/<slug>/` com `scripts/`, `templates/` e
  `runs/<run_id>/`. Execuções com mais de 90 dias são apagadas (configurável).

---

## 7. Fases

### Fase 13 — Modelo configurável

- **Implementar:**
  - `--model`, `--effort` e `--fallback-model` no `ClaudeCodeProvider`;
  - seletor nas Configurações;
  - botão "Pensar mais";
  - modelo usado no rodapé da resposta;
  - padrão `sonnet` na migração das configurações.
- **Aceite:**
  - perfil novo → `system/init` reporta Sonnet;
  - trocar para Opus nas Configurações → a próxima resposta reporta Opus;
  - "Pensar mais" refaz a última resposta com opus/high;
  - testes do provider cobrem os args.

### Fase 14 — Núcleo de Pipos

- **Implementar:**
  - migração 002;
  - repositórios;
  - pasta por Pipo;
  - cofre de segredos por Pipo;
  - IPC tipado `pipos:*`;
  - CRUD básico na aba Equipe (sem execução ainda).
- **Aceite:**
  - criar, editar, pausar e apagar um Pipo pela interface;
  - segredo salvo não aparece em nenhum log nem no banco em texto claro.

### Fase 15 — Executor de processos

- **Implementar:**
  - `src/main/pipos/runner.ts` com os passos `script`, `http`, `agent`, `confirm`, `branch` e `notify`;
  - templating de saídas;
  - timeouts;
  - cancelamento;
  - 1 execução por Pipo e no máximo 2 simultâneas;
  - modo seco;
  - máscara de segredos;
  - pausa após 3 falhas;
  - eventos de progresso para a UI.
- **Aceite:**
  - um processo de teste com 5 passos (script → agent → confirm → branch → notify) roda;
  - cancelar no meio mata o filho;
  - recusar o `confirm` encerra como "cancelled";
  - testes de unidade do executor passam.

### Fase 16 — Montagem conversacional

- **Implementar:**
  - modo "criar Pipo" no chat do branco;
  - ferramentas MCP de construção: `draft_pipo`, `add_step`, `edit_step`, `test_step` (sempre seco),
    `request_secret` (abre campo seguro no notch, o valor nunca passa pelo chat), `import_script`
    (arrastar o script existente) e `propose_version` (diff + Y/N).
- **Aceite:**
  - descrever o Prospector em linguagem natural resulta em um processo com os passos certos;
  - o ensaio seco roda inteiro;
  - aprovar cria a v1;
  - pedir uma mudança depois gera a v2 com diff.

### Fase 17 — Gatilhos

- **Implementar:**
  - gatilho manual: botão, `@slug` no chat e atalho opcional;
  - agenda em linguagem natural ("seg–sex 9h", "a cada 2h das 8 às 18") convertida em cron local, com
    prévia das próximas 3 execuções;
  - recuperação: se o PC estava desligado, pergunta "rodar a das 9h que perdeu?";
  - execuções agendadas não interrompem foco ou reunião (só o card final entra no orçamento de
    interrupções).
- **Aceite:**
  - uma agenda de 2 min dispara 2 vezes;
  - durante um foco, o card final vai para a fila;
  - `@prospector roda` no chat dispara a execução.

### Fase 18 — Pipos coloridos (visual)

- **Implementar:**
  - paleta;
  - mini-Pipos na pill com os 5 estados;
  - tooltip;
  - aba Equipe com cartões;
  - tela de execução em linha do tempo;
  - chat por Pipo com a cor dele;
  - seletor de acessório.
- **Aceite:**
  - capturas de cada estado contra a referência;
  - 4 Pipos rodando juntos não pesam (CPU ociosa abaixo de 2%);
  - a transição de aceso para apagado é suave.

### Fase 19 — Conectores do Prospector

- **Implementar:**
  - **Apify:** token; rodar o actor; aguardar; baixar o dataset.
  - **Resend:** API key; envio com template; idempotência por lead; consulta de status.
  - **Google Sheets:** escopo `spreadsheets` adicionado ao OAuth existente; ler, acrescentar e
    atualizar linhas por chave.
  - **Template "Pipo Prospector"** pronto na galeria.
- **Aceite:**
  - execução real com uma lista de teste de 3 e-mails próprios;
  - a planilha atualiza;
  - rodar de novo não reenvia (idempotência);
  - o card final traz os números certos.

### Fase 20 — Análises

- **Implementar:**
  - painel Análises (seção 4.1 e 4.2);
  - funil do Prospector;
  - métricas por Pipo;
  - relatório semanal;
  - ferramentas MCP de consulta agregada para o agente responder perguntas livres.
- **Aceite:**
  - com dados simulados de 4 semanas, o painel e o funil batem com o banco;
  - "qual assunto teve mais resposta?" é respondido corretamente.

### Fase 21 — Templates e extras

- **Implementar:**
  - templates Follow-up, Relatório para cliente, Triagem e Investidor;
  - encadeamento;
  - gatilho por e-mail e por pasta;
  - aprovação em lote;
  - memória por Pipo;
  - exportar/importar `.pipo`.
- **Aceite:** cada template roda em modo seco a partir da galeria.

### Fase 22 — Polimento e empacotamento V2

- **Implementar:**
  - migração de perfis da V1 sem perda;
  - README e `docs/pipos.md`;
  - workflow de build;
  - teste de fumaça com o app empacotado no Windows e no macOS.
- **Aceite:**
  - CI verde;
  - instaladores gerados;
  - atualizar da V1 mantém tarefas, histórico e configurações.

---

## 8. Fora do escopo da V2

- Pipos executando com o PC desligado: fica para a V3 (nuvem).
- Ordens de compra/venda reais no Pipo Investidor: nunca.
- Bash livre para qualquer Pipo: nunca.
